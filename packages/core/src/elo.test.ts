import { describe, expect, it } from 'vitest';
import {
  INITIAL_RATING,
  K_PROVISIONAL,
  K_STANDARD,
  PROVISIONAL_GAMES,
  RATING_FLOOR,
  expectedScore,
  initialRating,
  kFactor,
  opposingTeamRating,
  updatedRating,
} from './elo';

describe('seeding and K-factor', () => {
  it('seeds new ratings at 1200 with zero games', () => {
    expect(initialRating()).toEqual({ rating: 1200, gamesPlayed: 0 });
    expect(INITIAL_RATING).toBe(1200);
  });

  it('uses the provisional K for the first 20 games, then standard', () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES - 1)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES)).toBe(K_STANDARD);
    expect(kFactor(500)).toBe(K_STANDARD);
  });
});

describe('expectedScore', () => {
  it('is 0.5 between equals and sums to 1 across both sides', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    const a = expectedScore(1400, 1100);
    const b = expectedScore(1100, 1400);
    expect(a + b).toBeCloseTo(1, 10);
    expect(a).toBeGreaterThan(0.5);
  });

  it('matches the canonical 400-point spread expectation', () => {
    // A 400-point favorite expects ~0.909.
    expect(expectedScore(1600, 1200)).toBeCloseTo(10 / 11, 3);
  });
});

describe('updatedRating', () => {
  it('moves a provisional player by K/2 for a win between equals', () => {
    const next = updatedRating({ rating: 1200, gamesPlayed: 0 }, 1200, 1);
    expect(next.rating).toBe(1200 + K_PROVISIONAL / 2);
    expect(next.gamesPlayed).toBe(1);
  });

  it('moves an established player by the standard K', () => {
    const next = updatedRating({ rating: 1200, gamesPlayed: 50 }, 1200, 0);
    expect(next.rating).toBe(1200 - K_STANDARD / 2);
  });

  it('a draw between equals changes nothing', () => {
    const next = updatedRating({ rating: 1500, gamesPlayed: 50 }, 1500, 0.5);
    expect(next.rating).toBe(1500);
  });

  it('an upset win pays more than an expected win', () => {
    const underdog = updatedRating({ rating: 1200, gamesPlayed: 50 }, 1500, 1);
    const favorite = updatedRating({ rating: 1500, gamesPlayed: 50 }, 1200, 1);
    expect(underdog.rating - 1200).toBeGreaterThan(favorite.rating - 1500);
  });

  it('never drops below the floor', () => {
    // A near-floor player losing to an equal would drop K/2 = 20 points,
    // which the floor truncates.
    const self = { rating: RATING_FLOOR + 5, gamesPlayed: 0 };
    const next = updatedRating(self, RATING_FLOOR + 5, 0);
    expect(next.rating).toBe(RATING_FLOOR);
  });

  it('returns whole numbers', () => {
    const next = updatedRating({ rating: 1234, gamesPlayed: 7 }, 1391, 1);
    expect(Number.isInteger(next.rating)).toBe(true);
  });
});

describe('opposingTeamRating', () => {
  it('averages the opposing Hand and Brain relevant ratings', () => {
    expect(opposingTeamRating({ handRating: 1300, brainRating: 1100 })).toBe(1200);
  });
});
