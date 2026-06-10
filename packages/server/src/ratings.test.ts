import { describe, expect, it } from 'vitest';
import { INITIAL_RATING, K_PROVISIONAL, Role } from '@hnb/core';
import { RatingBook } from './ratings';
import type { SeatPlan } from './matchmaking';

const SEATS: SeatPlan = {
  w: { brain: 'wb', hand: 'wh' },
  b: { brain: 'bb', hand: 'bh' },
};

describe('RatingBook', () => {
  it('seeds unknown players at the initial rating', () => {
    const book = new RatingBook();
    expect(book.ratingsOf('new')).toEqual({
      hand: { rating: INITIAL_RATING, gamesPlayed: 0 },
      brain: { rating: INITIAL_RATING, gamesPlayed: 0 },
    });
  });

  it('updates only the played role rating, for all four players', () => {
    const book = new RatingBook();
    const changes = book.applyMatchResult(SEATS, 'w');
    expect(changes).toHaveLength(4);

    // Equal seeds: winners gain K/2, losers lose K/2 (provisional K).
    const delta = K_PROVISIONAL / 2;
    expect(book.ratingsOf('wb').brain.rating).toBe(INITIAL_RATING + delta);
    expect(book.ratingsOf('wh').hand.rating).toBe(INITIAL_RATING + delta);
    expect(book.ratingsOf('bb').brain.rating).toBe(INITIAL_RATING - delta);
    expect(book.ratingsOf('bh').hand.rating).toBe(INITIAL_RATING - delta);

    // The unplayed role is untouched and uncounted.
    expect(book.ratingsOf('wb').hand).toEqual({
      rating: INITIAL_RATING,
      gamesPlayed: 0,
    });
    expect(book.ratingsOf('wb').brain.gamesPlayed).toBe(1);
  });

  it('a draw between equal teams changes no ratings', () => {
    const book = new RatingBook();
    book.applyMatchResult(SEATS, null);
    for (const id of ['wb', 'wh', 'bb', 'bh']) {
      const ratings = book.ratingsOf(id);
      expect(ratings.hand.rating).toBe(INITIAL_RATING);
      expect(ratings.brain.rating).toBe(INITIAL_RATING);
    }
  });

  it('uses the opposing team average relevant rating, from pre-match values', () => {
    const book = new RatingBook();
    // Black team is strong: brain 1600, hand 1400 -> average 1500.
    book.ratingsOf('bb').brain = { rating: 1600, gamesPlayed: 30 };
    book.ratingsOf('bh').hand = { rating: 1400, gamesPlayed: 30 };

    const changes = book.applyMatchResult(SEATS, 'w');

    // White brain (1200, provisional) beat a 1500-average team:
    // E = 1/(1+10^((1500-1200)/400)) ≈ 0.1510, gain = 40 * 0.8490 ≈ 34.
    const whiteBrain = changes.find((c) => c.playerId === 'wb')!;
    expect(whiteBrain.role).toBe(Role.Brain);
    expect(whiteBrain.after.rating).toBe(1234);

    // Black brain (1600, established) lost to a 1200-average team:
    // E = 1/(1+10^((1200-1600)/400)) ≈ 0.9091, change = 32 * (0-0.9091) ≈ -29.
    const blackBrain = changes.find((c) => c.playerId === 'bb')!;
    expect(blackBrain.after.rating).toBe(1571);
  });
});
