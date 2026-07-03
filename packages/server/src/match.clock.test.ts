import { describe, expect, it } from 'vitest';
import { Match } from './match';
import type { SeatPlan } from './matchmaking';

const SEATS: SeatPlan = {
  w: { brain: 'wb', hand: 'wh' },
  b: { brain: 'bb', hand: 'bh' },
};

/** 10s base + 2s increment, match starts at t=0. */
function timedMatch(): Match {
  return new Match('m1', SEATS, { baseMs: 10_000, incrementMs: 2_000 }, 0);
}

describe('team clocks', () => {
  it('an untimed match has no clock view and never flags', () => {
    const match = new Match('m1', SEATS);
    expect(match.clockView(999_999)).toBeNull();
    expect(match.msUntilFlag(999_999)).toBeNull();
    expect(match.checkTimeout(999_999)).toBe(false);
  });

  it('runs one clock per team across both Brain and Hand phases', () => {
    const match = timedMatch();

    // While White thinks (Brain phase), White's bank drains; Black's doesn't.
    expect(match.clockView(3_000)).toEqual({
      remaining: { w: 7_000, b: 10_000 },
      running: 'w',
    });

    match.selectPieceType('wb', 'p', 1_000); // Brain time counts too
    match.selectMove('wh', { from: 'e2', to: 'e4' }, 4_000);

    // White spent 4s total, then gained the 2s increment: 10-4+2 = 8s.
    // Black's clock started at the move and is now running.
    expect(match.clockView(5_000)).toEqual({
      remaining: { w: 8_000, b: 9_000 },
      running: 'b',
    });
  });

  it('flags the running side when its bank empties', () => {
    const match = timedMatch();
    expect(match.checkTimeout(9_999)).toBe(false);
    expect(match.checkTimeout(10_000)).toBe(true);
    expect(match.outcome()).toEqual({ winner: 'b', by: 'timeout' });
    expect(match.clockView(10_000)).toEqual({
      remaining: { w: 0, b: 10_000 },
      running: null,
    });
  });

  it('ignores an action that arrives after the flag fell', () => {
    const match = timedMatch();
    match.selectPieceType('wb', 'p', 11_000); // too late
    expect(match.isFinished()).toBe(true);
    expect(match.outcome()).toEqual({ winner: 'b', by: 'timeout' });
    // The game position never changed.
    expect(match.snapshot().history).toEqual([]);
  });

  it('msUntilFlag reports the running side and stops when finished', () => {
    const match = timedMatch();
    expect(match.msUntilFlag(4_000)).toBe(6_000);
    match.resign('wh');
    expect(match.msUntilFlag(4_000)).toBeNull();
  });

  it('the bank never goes negative even after a long think', () => {
    const match = timedMatch();
    match.selectPieceType('wb', 'p', 9_500);
    match.selectMove('wh', { from: 'e2', to: 'e4' }, 9_900);
    // Spent 9.9s of 10s, +2s increment: 10 - 9.9 + 2 = 2.1s left.
    expect(match.clockView(9_900)!.remaining.w).toBe(2_100);
  });
});
