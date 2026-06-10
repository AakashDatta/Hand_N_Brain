import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerMessage } from '@hnb/core';
import { Lobby } from './lobby';
import { JsonFileStore } from './store';

/**
 * End-to-end persistence: a match played against one Lobby must be fully
 * recoverable by a fresh Lobby pointed at the same store — identities (by
 * token), ratings, and match history all survive a "restart".
 */

class FakeTransport {
  readonly inbox = new Map<string, ServerMessage[]>();
  send(playerId: string, message: ServerMessage): void {
    const list = this.inbox.get(playerId) ?? [];
    list.push(message);
    this.inbox.set(playerId, list);
  }
  last<T extends ServerMessage['type']>(playerId: string, type: T) {
    const all = (this.inbox.get(playerId) ?? []).filter(
      (m): m is Extract<ServerMessage, { type: T }> => m.type === type,
    );
    return all[all.length - 1];
  }
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hnb-lobby-'));
  file = join(dir, 'state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function playRatedMatch(lobby: Lobby, transport: FakeTransport) {
  const ids = ['P1', 'P2', 'P3', 'P4'].map((n) => lobby.hello(undefined, n));
  for (const id of ids) lobby.handleMessage(id, { type: 'queue-join', role: 'either' });

  const found = transport.last(ids[0], 'match-found');
  const matchId = found.matchId;
  const seat = (color: string, role: string) =>
    found.players.find((p) => p.seat.color === color && p.seat.role === role)!.playerId;

  // Black resigns immediately — White team wins, all four ratings move.
  lobby.handleMessage(seat('b', 'HAND'), { type: 'resign', matchId });
  return { ids, tokens: ids.map((id) => transport.last(id, 'welcome').token) };
}

describe('lobby persistence across restart', () => {
  it('restores ratings, history, and token identities from the store', () => {
    const store = new JsonFileStore(file);

    // --- First process: play one rated match. ---
    const t1 = new FakeTransport();
    const lobby1 = new Lobby(t1, { store, abandonTimeoutMs: 1000 });
    const { ids, tokens } = playRatedMatch(lobby1, t1);

    const winnerToken = tokens[ids.indexOf(playerWhoWon(t1, ids))];
    const winnerRatingAfter = winnerRating(t1, ids);

    // --- Second process: a fresh lobby on the same store. ---
    const t2 = new FakeTransport();
    const lobby2 = new Lobby(t2, { store, abandonTimeoutMs: 1000 });

    // Reconnect by token -> same identity, ratings preserved.
    const rejoinedId = lobby2.hello(winnerToken, undefined);
    const welcome = t2.last(rejoinedId, 'welcome');
    expect(welcome.token).toBe(winnerToken);
    const restored = welcome.ratings.hand.rating + welcome.ratings.brain.rating;
    expect(restored).toBe(winnerRatingAfter.hand + winnerRatingAfter.brain);

    // History survived too.
    lobby2.handleMessage(rejoinedId, { type: 'get-profile' });
    const profile = t2.last(rejoinedId, 'profile');
    expect(profile.history).toHaveLength(1);

    // The leaderboard is rebuilt from persisted ratings (4 rated players).
    lobby2.handleMessage(rejoinedId, { type: 'get-leaderboard' });
    const board = t2.last(rejoinedId, 'leaderboard');
    expect(board.hand).toHaveLength(2);
    expect(board.brain).toHaveLength(2);
  });

  it('a fresh lobby with no prior file simply starts empty', () => {
    const t = new FakeTransport();
    const lobby = new Lobby(t, { store: new JsonFileStore(file) });
    const id = lobby.hello(undefined, 'Solo');
    expect(t.last(id, 'welcome').ratings.hand).toEqual({
      rating: 1200,
      gamesPlayed: 0,
    });
  });
});

// --- helpers reading the recorded transport ---
function playerWhoWon(t: FakeTransport, ids: string[]): string {
  // The winner's rating-update shows an increase.
  for (const id of ids) {
    const ru = t.last(id, 'rating-update');
    if (ru && ru.after.rating > ru.before.rating) return id;
  }
  throw new Error('no winner found');
}

function winnerRating(t: FakeTransport, ids: string[]) {
  const id = playerWhoWon(t, ids);
  const welcome = t.last(id, 'welcome');
  const ru = t.last(id, 'rating-update');
  // The role they played is updated; the other keeps its welcome value.
  const hand = ru.role === 'HAND' ? ru.after.rating : welcome.ratings.hand.rating;
  const brain = ru.role === 'BRAIN' ? ru.after.rating : welcome.ratings.brain.rating;
  return { hand, brain };
}
