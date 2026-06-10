/**
 * Matchmaking: pure queue-pairing logic, kept free of sockets and timers so
 * it can be tested directly.
 *
 * A match needs four players filling two Brains and two Hands. Players queue
 * with a role preference ('hand', 'brain', or 'either').
 *
 * Selection: the longest-waiting player anchors the match; the other three
 * are chosen rating-closest-first (falling back to pure queue order when no
 * rating lookup is supplied). Team split then minimizes the strength gap
 * between the two teams, where team strength is the average of the relevant
 * role ratings — the same definition the Elo update uses.
 */
import { Role, type Color, type QueueRole } from '@hnb/core';

export interface QueueEntry {
  playerId: string;
  role: QueueRole;
  joinedAt: number;
}

/** A formed pairing: which player sits in each of the four seats. */
export type SeatPlan = Record<Color, { brain: string; hand: string }>;

export interface FormedMatch {
  seats: SeatPlan;
  /** Queue entries left over, in their original order. */
  remaining: QueueEntry[];
}

/** Rating lookup used for pairing; absent means rating-blind FIFO pairing. */
export type RatingLookup = (playerId: string, role: Role) => number;

/**
 * Try to form one match from the queue. Returns null if no four compatible
 * players exist yet.
 *
 * Greedy scan over candidates: take each entry if it can still fit one of
 * the remaining role slots (2 brains, 2 hands; 'either' counts toward
 * whichever is open when the selection is finalized). The longest-waiting
 * player is always considered first; with a rating lookup, the remaining
 * candidates are visited closest-in-rating-to-the-anchor first, so matches
 * are made between players of similar strength.
 */
export function tryFormMatch(
  queue: QueueEntry[],
  ratingOf?: RatingLookup,
): FormedMatch | null {
  if (queue.length < 4) return null;

  const anchor = queue[0];
  const candidates = ratingOf
    ? [anchor, ...rankByRatingDistance(queue.slice(1), anchor, ratingOf)]
    : queue;

  const selected: QueueEntry[] = [];
  let fixedBrains = 0;
  let fixedHands = 0;

  for (const entry of candidates) {
    if (entry.role === 'brain' && fixedBrains === 2) continue;
    if (entry.role === 'hand' && fixedHands === 2) continue;
    // An 'either' always fits as long as fewer than 4 are selected: at most
    // two of each fixed role are admitted, so a free slot always remains.
    if (entry.role === 'brain') fixedBrains++;
    if (entry.role === 'hand') fixedHands++;
    selected.push(entry);
    if (selected.length === 4) break;
  }
  if (selected.length < 4) return null;

  // Assign roles: fixed preferences first, 'either' players fill what's left.
  const brains: string[] = [];
  const hands: string[] = [];
  for (const entry of selected) {
    if (entry.role === 'brain') brains.push(entry.playerId);
    if (entry.role === 'hand') hands.push(entry.playerId);
  }
  for (const entry of selected) {
    if (entry.role !== 'either') continue;
    if (brains.length < 2) {
      brains.push(entry.playerId);
    } else {
      hands.push(entry.playerId);
    }
  }

  const selectedIds = new Set(selected.map((e) => e.playerId));
  return {
    seats: splitIntoTeams(brains, hands, ratingOf),
    remaining: queue.filter((e) => !selectedIds.has(e.playerId)),
  };
}

/**
 * The rating to pair a queue entry on: the rating of their fixed role, or
 * the mean of both ratings for an 'either' player.
 */
function pairingRating(entry: QueueEntry, ratingOf: RatingLookup): number {
  switch (entry.role) {
    case 'brain':
      return ratingOf(entry.playerId, Role.Brain);
    case 'hand':
      return ratingOf(entry.playerId, Role.Hand);
    case 'either':
      return (
        (ratingOf(entry.playerId, Role.Brain) +
          ratingOf(entry.playerId, Role.Hand)) /
        2
      );
  }
}

/** Stable order by rating distance to the anchor (FIFO breaks ties). */
function rankByRatingDistance(
  entries: QueueEntry[],
  anchor: QueueEntry,
  ratingOf: RatingLookup,
): QueueEntry[] {
  const anchorRating = pairingRating(anchor, ratingOf);
  return entries
    .map((entry, index) => ({
      entry,
      index,
      distance: Math.abs(pairingRating(entry, ratingOf) - anchorRating),
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((x) => x.entry);
}

/**
 * Split two brains and two hands into teams. With ratings available, choose
 * the pairing that minimizes the strength gap between the teams (strength =
 * average of the relevant role ratings, matching the Elo definition).
 */
function splitIntoTeams(
  brains: string[],
  hands: string[],
  ratingOf?: RatingLookup,
): SeatPlan {
  const straight: SeatPlan = {
    w: { brain: brains[0], hand: hands[0] },
    b: { brain: brains[1], hand: hands[1] },
  };
  if (!ratingOf) return straight;

  const crossed: SeatPlan = {
    w: { brain: brains[0], hand: hands[1] },
    b: { brain: brains[1], hand: hands[0] },
  };
  const gap = (plan: SeatPlan) => {
    const strength = (team: SeatPlan['w']) =>
      (ratingOf(team.brain, Role.Brain) + ratingOf(team.hand, Role.Hand)) / 2;
    return Math.abs(strength(plan.w) - strength(plan.b));
  };
  return gap(crossed) < gap(straight) ? crossed : straight;
}

/** All four player ids of a seat plan. */
export function seatPlanPlayers(seats: SeatPlan): string[] {
  return [seats.w.brain, seats.w.hand, seats.b.brain, seats.b.hand];
}

/** The seat (color + role) a player occupies, or null if not in this plan. */
export function seatOf(
  seats: SeatPlan,
  playerId: string,
): { color: Color; role: Role } | null {
  const colors: Color[] = ['w', 'b'];
  for (const color of colors) {
    if (seats[color].brain === playerId) return { color, role: Role.Brain };
    if (seats[color].hand === playerId) return { color, role: Role.Hand };
  }
  return null;
}
