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

  it('is first-come-first-served', () => {
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
