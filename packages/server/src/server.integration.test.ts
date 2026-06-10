import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@hnb/core';
import { startServer, type GameServer } from './server';

/**
 * Real-socket integration test: boots the actual HTTP+WS server on an
 * ephemeral port, connects four WebSocket clients, queues them, and plays the
 * opening moves of a match end to end.
 */

class TestClient {
  private socket!: WebSocket;
  private readonly received: ServerMessage[] = [];
  private waiters: {
    test: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
  }[] = [];

  async connect(port: number): Promise<void> {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      this.received.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (w.test(message)) {
          w.resolve(message);
          return false;
        }
        return true;
      });
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolve with the first (possibly already-received) matching message. */
  waitFor<T extends ServerMessage['type']>(
    type: T,
    extra?: (m: Extract<ServerMessage, { type: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const test = (m: ServerMessage) =>
      m.type === type && (!extra || extra(m as Extract<ServerMessage, { type: T }>));
    const already = this.received.find(test);
    if (already) return Promise.resolve(already as Extract<ServerMessage, { type: T }>);
    return new Promise((resolve) => {
      this.waiters.push({ test, resolve: resolve as (m: ServerMessage) => void });
    });
  }

  close(): void {
    this.socket.close();
  }
}

let server: GameServer;
const clients: TestClient[] = [];

beforeAll(async () => {
  server = await startServer({ port: 0 });
  for (let i = 0; i < 4; i++) {
    const client = new TestClient();
    await client.connect(server.port);
    clients.push(client);
  }
});

afterAll(async () => {
  for (const client of clients) client.close();
  await server.close();
});

describe('online match over real sockets', () => {
  it('forms a match and plays validated moves end to end', async () => {
    // Handshake all four clients.
    clients.forEach((client, i) => client.send({ type: 'hello', name: `P${i}` }));
    await Promise.all(clients.map((c) => c.waitFor('welcome')));

    // Queue everyone; a match must form.
    for (const client of clients) client.send({ type: 'queue-join', role: 'either' });
    const founds = await Promise.all(clients.map((c) => c.waitFor('match-found')));
    const matchId = founds[0].matchId;
    expect(founds.every((f) => f.matchId === matchId)).toBe(true);

    const byseat = (color: string, role: string) =>
      clients[
        founds.findIndex(
          (f) => f.yourSeat.color === color && f.yourSeat.role === role,
        )
      ];

    // White Brain names pawn; White Hand plays e4. The server validates both
    // and broadcasts the new authoritative state to everyone.
    byseat('w', 'BRAIN').send({ type: 'select-piece-type', matchId, pieceType: 'p' });
    await Promise.all(
      clients.map((c) =>
        c.waitFor('match-state', (m) => m.snapshot.selectedPieceType === 'p'),
      ),
    );

    byseat('w', 'HAND').send({ type: 'select-move', matchId, from: 'e2', to: 'e4' });
    const states = await Promise.all(
      clients.map((c) =>
        c.waitFor('match-state', (m) => m.snapshot.history.length === 1),
      ),
    );
    for (const state of states) {
      expect(state.snapshot.history).toEqual(['e4']);
      expect(state.snapshot.turn).toBe('b');
    }

    // An out-of-turn action is rejected with a typed error.
    byseat('w', 'BRAIN').send({ type: 'select-piece-type', matchId, pieceType: 'p' });
    const error = await byseat('w', 'BRAIN').waitFor('error-message');
    expect(error.code).toBe('not-your-turn');

    // Malformed JSON is answered with bad-message, not a crash.
    (byseat('w', 'HAND') as unknown as { socket: WebSocket }).socket.send('}{');
    const bad = await byseat('w', 'HAND').waitFor(
      'error-message',
      (m) => m.code === 'bad-message',
    );
    expect(bad.code).toBe('bad-message');
  }, 15_000);
});
