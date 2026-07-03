import { describe, expect, it } from 'vitest';
import { seatOf, seatPlanPlayers, tryFormMatch, type QueueEntry } from './matchmaking';
import { Role } from '@hnb/core';

function entry(playerId: string, role: QueueEntry['role'], joinedAt = 0): QueueEntry {
  return { playerId, role, joinedAt };
}

describe('tryFormMatch', () => {
  it('returns null with fewer than four players', () => {
    expect(tryFormMatch([])).toBeNull();
    expect(
      tryFormMatch([entry('a', 'either'), entry('b', 'either'), entry('c', 'either')]),
    ).toBeNull();
  });

  it('forms a match from four "either" players in queue order', () => {
    const formed = tryFormMatch([
      entry('a', 'either'),
      entry('b', 'either'),
      entry('c', 'either'),
      entry('d', 'either'),
    ])!;
    expect(formed).not.toBeNull();
    expect(seatPlanPlayers(formed.seats).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(formed.remaining).toEqual([]);
  });

  it('honors fixed role preferences exactly', () => {
    const formed = tryFormMatch([
      entry('brain1', 'brain'),
      entry('hand1', 'hand'),
      entry('brain2', 'brain'),
      entry('hand2', 'hand'),
    ])!;
    expect(seatOf(formed.seats, 'brain1')).toEqual({ color: 'w', role: Role.Brain });
    expect(seatOf(formed.seats, 'hand1')).toEqual({ color: 'w', role: Role.Hand });
    expect(seatOf(formed.seats, 'brain2')).toEqual({ color: 'b', role: Role.Brain });
    expect(seatOf(formed.seats, 'hand2')).toEqual({ color: 'b', role: Role.Hand });
  });

  it('never assigns a fixed-role player to the other role', () => {
    const formed = tryFormMatch([
      entry('b1', 'brain'),
      entry('b2', 'brain'),
      entry('e1', 'either'),
      entry('e2', 'either'),
    ])!;
    expect(seatOf(formed.seats, 'b1')!.role).toBe(Role.Brain);
    expect(seatOf(formed.seats, 'b2')!.role).toBe(Role.Brain);
    expect(seatOf(formed.seats, 'e1')!.role).toBe(Role.Hand);
    expect(seatOf(formed.seats, 'e2')!.role).toBe(Role.Hand);
  });

  it('skips over-supplied roles and waits for compatible players', () => {
    // Three brains and one hand cannot form a match (need two hands).
    expect(
      tryFormMatch([
        entry('b1', 'brain'),
        entry('b2', 'brain'),
        entry('b3', 'brain'),
        entry('h1', 'hand'),
      ]),
    ).toBeNull();

    // A second hand arriving completes it; the third brain stays queued.
    const formed = tryFormMatch([
      entry('b1', 'brain'),
      entry('b2', 'brain'),
      entry('b3', 'brain'),
      entry('h1', 'hand'),
      entry('h2', 'hand'),
    ])!;
    expect(seatPlanPlayers(formed.seats).sort()).toEqual(['b1', 'b2', 'h1', 'h2']);
    expect(formed.remaining).toEqual([entry('b3', 'brain')]);
  });

  it('is first-come-first-served without ratings', () => {
    const formed = tryFormMatch([
      entry('a', 'either'),
      entry('b', 'either'),
      entry('c', 'either'),
      entry('d', 'either'),
      entry('e', 'either'),
    ])!;
    expect(seatPlanPlayers(formed.seats).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(formed.remaining.map((x) => x.playerId)).toEqual(['e']);
  });
});

describe('rating-aware pairing', () => {
  /** Same rating for both roles keeps these tests easy to read. */
  function lookupFrom(table: Record<string, number>) {
    return (playerId: string) => table[playerId];
  }

  it('anchors on the longest waiter and picks the closest-rated players', () => {
    const ratings = lookupFrom({
      anchor: 1200,
      strong1: 2000,
      near1: 1210,
      strong2: 1900,
      near2: 1190,
      near3: 1205,
    });
    const formed = tryFormMatch(
      [
        entry('anchor', 'either'),
        entry('strong1', 'either'),
        entry('near1', 'either'),
        entry('strong2', 'either'),
        entry('near2', 'either'),
        entry('near3', 'either'),
      ],
      ratings,
    )!;
    expect(seatPlanPlayers(formed.seats).sort()).toEqual([
      'anchor',
      'near1',
      'near2',
      'near3',
    ]);
    expect(formed.remaining.map((x) => x.playerId)).toEqual([
      'strong1',
      'strong2',
    ]);
  });

  it('splits teams to minimize the strength gap', () => {
    // Brains: 1600 and 1200. Hands: 1600 and 1200. A straight split would
    // give 1600/1600 vs 1200/1200 (gap 400); the balanced split pairs
    // strong with weak (gap 0).
    const ratings = lookupFrom({ b1: 1600, b2: 1200, h1: 1600, h2: 1200 });
    const formed = tryFormMatch(
      [entry('b1', 'brain'), entry('b2', 'brain'), entry('h1', 'hand'), entry('h2', 'hand')],
      ratings,
    )!;

    const teamStrength = (team: { brain: string; hand: string }) =>
      (ratings(team.brain) + ratings(team.hand)) / 2;
    expect(teamStrength(formed.seats.w)).toBe(teamStrength(formed.seats.b));
  });

  it('still honors fixed role preferences when ratings are in play', () => {
    const ratings = lookupFrom({ b1: 1500, b2: 1500, e1: 1500, e2: 1500 });
    const formed = tryFormMatch(
      [entry('b1', 'brain'), entry('b2', 'brain'), entry('e1', 'either'), entry('e2', 'either')],
      ratings,
    )!;
    expect(seatOf(formed.seats, 'b1')!.role).toBe(Role.Brain);
    expect(seatOf(formed.seats, 'b2')!.role).toBe(Role.Brain);
  });
});
