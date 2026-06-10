import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@hnb/core';
import { Lobby } from './lobby';

/**
 * Drives the whole online flow through the Lobby with a recording transport —
 * no sockets involved. This is the main test of the server's behavior.
 */

class FakeTransport {
  readonly inbox = new Map<string, ServerMessage[]>();

  send(playerId: string, message: ServerMessage): void {
    const list = this.inbox.get(playerId) ?? [];
    list.push(message);
    this.inbox.set(playerId, list);
  }

  /** Messages of one type for a player, newest last. */
  ofType<T extends ServerMessage['type']>(
    playerId: string,
    type: T,
  ): Extract<ServerMessage, { type: T }>[] {
    return (this.inbox.get(playerId) ?? []).filter(
      (m): m is Extract<ServerMessage, { type: T }> => m.type === type,
    );
  }

  last<T extends ServerMessage['type']>(playerId: string, type: T) {
    const all = this.ofType(playerId, type);
    return all[all.length - 1];
  }
}

let transport: FakeTransport;
let lobby: Lobby;

beforeEach(() => {
  transport = new FakeTransport();
  lobby = new Lobby(transport, { abandonTimeoutMs: 1000 });
});

/** Connect four named players and queue them all as 'either'. */
function queueFour(): string[] {
  const ids = ['P1', 'P2', 'P3', 'P4'].map((name) =>
    lobby.hello(undefined, name),
  );
  for (const id of ids) {
    lobby.handleMessage(id, { type: 'queue-join', role: 'either' });
  }
  return ids;
}

/** The player occupying a given seat in the most recent match of `anyId`. */
function playerInSeat(
  anyId: string,
  color: 'w' | 'b',
  role: 'BRAIN' | 'HAND',
): string {
  const found = transport.last(anyId, 'match-found');
  const player = found.players.find(
    (p) => p.seat.color === color && p.seat.role === role,
  )!;
  return player.playerId;
}

describe('identity', () => {
  it('welcomes new players with a token and re-attaches by token', () => {
    const id = lobby.hello(undefined, 'Alice');
    const welcome = transport.last(id, 'welcome');
    expect(welcome.name).toBe('Alice');
    expect(welcome.token).toBeTruthy();

    const again = lobby.hello(welcome.token, undefined);
    expect(again).toBe(id);
  });
});

describe('queueing and match formation', () => {
  it('reports queue status and forms a match at four players', () => {
    const ids = queueFour();

    for (const id of ids) {
      expect(transport.last(id, 'queue-status').queued).toBe(true);
      const found = transport.last(id, 'match-found');
      expect(found).toBeDefined();
      expect(found.players).toHaveLength(4);
      const state = transport.last(id, 'match-state');
      expect(state.snapshot.turn).toBe('w');
      expect(state.outcome).toBeNull();
    }

    // All four sit in distinct seats.
    const seats = transport
      .last(ids[0], 'match-found')
      .players.map((p) => `${p.seat.color}-${p.seat.role}`);
    expect(new Set(seats).size).toBe(4);
  });

  it('rejects double-queueing and queueing while in a match', () => {
    const id = lobby.hello(undefined, 'Solo');
    lobby.handleMessage(id, { type: 'queue-join', role: 'hand' });
    lobby.handleMessage(id, { type: 'queue-join', role: 'hand' });
    expect(transport.last(id, 'error-message').code).toBe('already-queued');

    const ids = queueFour();
    lobby.handleMessage(ids[0], { type: 'queue-join', role: 'either' });
    expect(transport.last(ids[0], 'error-message').code).toBe('illegal-action');
  });

  it('honors queue-leave', () => {
    const id = lobby.hello(undefined, 'Leaver');
    lobby.handleMessage(id, { type: 'queue-join', role: 'either' });
    lobby.handleMessage(id, { type: 'queue-leave' });
    expect(transport.last(id, 'queue-status').queued).toBe(false);

    // Three more players should NOT form a match (the leaver is gone).
    for (const name of ['A', 'B', 'C']) {
      const other = lobby.hello(undefined, name);
      lobby.handleMessage(other, { type: 'queue-join', role: 'either' });
    }
    expect(transport.ofType(id, 'match-found')).toHaveLength(0);
  });
});

describe('playing a match', () => {
  it('routes validated actions through the engine and broadcasts state', () => {
    const ids = queueFour();
    const matchId = transport.last(ids[0], 'match-found').matchId;
    const whiteBrain = playerInSeat(ids[0], 'w', 'BRAIN');
    const whiteHand = playerInSeat(ids[0], 'w', 'HAND');

    lobby.handleMessage(whiteBrain, {
      type: 'select-piece-type',
      matchId,
      pieceType: 'p',
    });
    lobby.handleMessage(whiteHand, {
      type: 'select-move',
      matchId,
      from: 'e2',
      to: 'e4',
    });

    for (const id of ids) {
      const state = transport.last(id, 'match-state');
      expect(state.snapshot.history).toEqual(['e4']);
      expect(state.snapshot.turn).toBe('b');
    }
  });

  it('rejects out-of-turn and illegal actions with error codes', () => {
    const ids = queueFour();
    const matchId = transport.last(ids[0], 'match-found').matchId;
    const blackBrain = playerInSeat(ids[0], 'b', 'BRAIN');
    const whiteBrain = playerInSeat(ids[0], 'w', 'BRAIN');

    lobby.handleMessage(blackBrain, {
      type: 'select-piece-type',
      matchId,
      pieceType: 'p',
    });
    expect(transport.last(blackBrain, 'error-message').code).toBe('not-your-turn');

    lobby.handleMessage(whiteBrain, {
      type: 'select-piece-type',
      matchId,
      pieceType: 'q', // no legal queen move from the start position
    });
    expect(transport.last(whiteBrain, 'error-message').code).toBe('illegal-action');
  });

  it('handles resignation and frees players for a new queue', () => {
    const ids = queueFour();
    const matchId = transport.last(ids[0], 'match-found').matchId;
    const whiteHand = playerInSeat(ids[0], 'w', 'HAND');

    lobby.handleMessage(whiteHand, { type: 'resign', matchId });

    const finalState = transport.last(ids[0], 'match-state');
    expect(finalState.outcome).toEqual({ winner: 'b', by: 'resignation' });

    // Players can queue again after the match ends.
    lobby.handleMessage(ids[0], { type: 'queue-join', role: 'either' });
    expect(transport.last(ids[0], 'queue-status').queued).toBe(true);
  });
});

describe('disconnection and reconnection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies others on disconnect and restores full context on reconnect', () => {
    const ids = queueFour();
    const dropped = ids[0];
    const token = transport.last(dropped, 'welcome').token;
    const matchId = transport.last(dropped, 'match-found').matchId;

    lobby.disconnect(dropped);
    for (const other of ids.slice(1)) {
      const note = transport.last(other, 'player-connection');
      expect(note).toMatchObject({ playerId: dropped, connected: false });
    }

    const back = lobby.hello(token, undefined);
    expect(back).toBe(dropped);
    const welcome = transport.last(dropped, 'welcome');
    expect(welcome.activeMatchId).toBe(matchId);
    // Context is rebuilt: a fresh match-found and authoritative state.
    expect(transport.ofType(dropped, 'match-found').length).toBeGreaterThan(1);
    expect(transport.last(dropped, 'match-state').matchId).toBe(matchId);
    for (const other of ids.slice(1)) {
      const note = transport.last(other, 'player-connection');
      expect(note).toMatchObject({ playerId: dropped, connected: true });
    }
  });

  it('forfeits the abandoned team after the timeout', () => {
    vi.useFakeTimers();
    const ids = queueFour();
    const dropped = playerInSeat(ids[0], 'w', 'BRAIN');

    lobby.disconnect(dropped);
    vi.advanceTimersByTime(999);
    // Not yet.
    const before = transport.last(ids.find((i) => i !== dropped)!, 'match-state');
    expect(before.outcome).toBeNull();

    vi.advanceTimersByTime(2);
    const after = transport.last(ids.find((i) => i !== dropped)!, 'match-state');
    expect(after.outcome).toEqual({ winner: 'b', by: 'resignation' });
  });

  it('a reconnect before the timeout cancels the forfeit', () => {
    vi.useFakeTimers();
    const ids = queueFour();
    const dropped = ids[0];
    const token = transport.last(dropped, 'welcome').token;

    lobby.disconnect(dropped);
    vi.advanceTimersByTime(500);
    lobby.hello(token, undefined);
    vi.advanceTimersByTime(10_000);

    const state = transport.last(ids[1], 'match-state');
    expect(state.outcome).toBeNull();
  });

  it('a disconnected queued player is removed from the queue', () => {
    const id = lobby.hello(undefined, 'Ghost');
    lobby.handleMessage(id, { type: 'queue-join', role: 'either' });
    lobby.disconnect(id);

    for (const name of ['A', 'B', 'C']) {
      const other = lobby.hello(undefined, name);
      lobby.handleMessage(other, { type: 'queue-join', role: 'either' });
    }
    expect(transport.ofType(id, 'match-found')).toHaveLength(0);
  });
});
