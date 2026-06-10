/**
 * The server's rating ledger. All Elo math lives in @hnb/core (see elo.ts);
 * this class only stores per-player rating state and applies the core update
 * rule to finished matches.
 *
 * Phase 2/3 keeps ratings in memory behind this seam; the Postgres-backed
 * implementation (see docs/data-model.md, `ratings` table) replaces the Map
 * without touching callers.
 */
import {
  Role,
  initialRating,
  opposingTeamRating,
  updatedRating,
  type Color,
  type PlayerRatings,
  type RatingState,
  type Score,
} from '@hnb/core';
import type { SeatPlan } from './matchmaking';

export interface RatingChange {
  playerId: string;
  role: Role;
  before: RatingState;
  after: RatingState;
}

export class RatingBook {
  private readonly byPlayer = new Map<string, PlayerRatings>();

  /** A player's ratings, created at the seed values on first reference. */
  ratingsOf(playerId: string): PlayerRatings {
    let ratings = this.byPlayer.get(playerId);
    if (!ratings) {
      ratings = { hand: initialRating(), brain: initialRating() };
      this.byPlayer.set(playerId, ratings);
    }
    return ratings;
  }

  /** Load a player's ratings from persisted state (overwrites any current). */
  hydrate(playerId: string, ratings: PlayerRatings): void {
    this.byPlayer.set(playerId, ratings);
  }

  /** The rating relevant to one role (what matchmaking pairs on). */
  relevantRating(playerId: string, role: Role): number {
    const ratings = this.ratingsOf(playerId);
    return role === Role.Hand ? ratings.hand.rating : ratings.brain.rating;
  }

  /** All players that have completed at least one rated game in the role. */
  ratedPlayers(role: Role): { playerId: string; state: RatingState }[] {
    const result: { playerId: string; state: RatingState }[] = [];
    for (const [playerId, ratings] of this.byPlayer) {
      const state = role === Role.Hand ? ratings.hand : ratings.brain;
      if (state.gamesPlayed > 0) {
        result.push({ playerId, state });
      }
    }
    return result;
  }

  /**
   * Apply the dual-Elo update for a finished match. Every player updates
   * only their role rating, against the opposing team's average relevant
   * rating, all computed from PRE-match ratings.
   */
  applyMatchResult(seats: SeatPlan, winner: Color | null): RatingChange[] {
    // Snapshot opponent strengths before any update is written.
    const teamRating = (color: Color) =>
      opposingTeamRating({
        handRating: this.relevantRating(seats[color].hand, Role.Hand),
        brainRating: this.relevantRating(seats[color].brain, Role.Brain),
      });
    const strengths: Record<Color, number> = { w: teamRating('w'), b: teamRating('b') };

    const changes: RatingChange[] = [];
    const colors: Color[] = ['w', 'b'];
    for (const color of colors) {
      const opponent: Color = color === 'w' ? 'b' : 'w';
      const score: Score = winner === null ? 0.5 : winner === color ? 1 : 0;
      const team = seats[color];

      for (const role of [Role.Brain, Role.Hand]) {
        const playerId = role === Role.Brain ? team.brain : team.hand;
        const ratings = this.ratingsOf(playerId);
        const before = role === Role.Brain ? ratings.brain : ratings.hand;
        const after = updatedRating(before, strengths[opponent], score);
        if (role === Role.Brain) {
          ratings.brain = after;
        } else {
          ratings.hand = after;
        }
        changes.push({ playerId, role, before, after });
      }
    }
    return changes;
  }
}
