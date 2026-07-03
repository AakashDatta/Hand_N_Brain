/**
 * The dual-rating Elo system: every player has two independent ratings, one
 * as Hand and one as Brain. All tunables and formulas live here, isolated
 * from the server, so the design can be retuned and tested in one place.
 *
 * Design (see docs/data-model.md):
 * - Seed 1200. Provisional K=40 for a role's first 20 games, then K=32.
 * - Ratings are floored at 100.
 * - A game is Team A (Hand + Brain) vs Team B (Hand + Brain). Each player
 *   updates only the rating of the role they played, using the OPPOSING
 *   team's average relevant rating as the opponent rating and the team
 *   outcome S (win 1 / draw 0.5 / loss 0):
 *     E  = 1 / (1 + 10^((R_opp − R_self)/400))
 *     R' = R + K·(S − E)
 * - "Average relevant rating" of a team = mean of its Hand's hand-rating and
 *   its Brain's brain-rating. This definition is an explicitly tunable
 *   choice; everything routes through opposingTeamRating() to keep it so.
 */

export const INITIAL_RATING = 1200;
export const RATING_FLOOR = 100;
export const PROVISIONAL_GAMES = 20;
export const K_PROVISIONAL = 40;
export const K_STANDARD = 32;

/** One role-rating: the rating value and how many rated games produced it. */
export interface RatingState {
  rating: number;
  gamesPlayed: number;
}

export function initialRating(): RatingState {
  return { rating: INITIAL_RATING, gamesPlayed: 0 };
}

/** Team outcome from one team's perspective. */
export type Score = 1 | 0.5 | 0;

/** Provisional players move faster so they reach their level quickly. */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES ? K_PROVISIONAL : K_STANDARD;
}

/** Standard Elo expectation of self scoring against an opponent rating. */
export function expectedScore(selfRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - selfRating) / 400));
}

/**
 * The opponent rating a player faces: the opposing team's average relevant
 * rating (its Hand's hand-rating averaged with its Brain's brain-rating).
 */
export function opposingTeamRating(opposingTeam: {
  handRating: number;
  brainRating: number;
}): number {
  return (opposingTeam.handRating + opposingTeam.brainRating) / 2;
}

/**
 * One player's updated role rating after a game. Returns a whole number,
 * never below the floor, with the game counted.
 */
export function updatedRating(
  self: RatingState,
  opponentRating: number,
  score: Score,
): RatingState {
  const k = kFactor(self.gamesPlayed);
  const expected = expectedScore(self.rating, opponentRating);
  const raw = self.rating + k * (score - expected);
  return {
    rating: Math.max(RATING_FLOOR, Math.round(raw)),
    gamesPlayed: self.gamesPlayed + 1,
  };
}

/**
 * Matchmaking's view of a team's strength: the same average-relevant-rating
 * definition, so pairing and updating agree with each other.
 */
export function teamStrength(team: {
  handRating: number;
  brainRating: number;
}): number {
  return opposingTeamRating(team);
}
