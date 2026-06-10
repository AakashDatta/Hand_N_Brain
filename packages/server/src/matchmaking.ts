/**
 * Matchmaking: pure queue-pairing logic, kept free of sockets and timers so
 * it can be tested directly.
 *
 * A match needs four players filling two Brains and two Hands. Players queue
 * with a role preference ('hand', 'brain', or 'either'). Pairing is
 * first-come-first-served in queue order; Phase 3 will add rating-based
 * pairing (team strength = average of the relevant role ratings) on top of
 * the same selection mechanism.
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

/**
 * Try to form one match from the queue, oldest entries first.
 *
 * Greedy scan: take each entry in order if it can still fit one of the
 * remaining role slots (2 brains, 2 hands; 'either' counts toward whichever
 * is open when the selection is finalized). Returns null if no four
 * queue-order-compatible players exist yet.
 */
export function tryFormMatch(queue: QueueEntry[]): FormedMatch | null {
  if (queue.length < 4) return null;

  const selected: QueueEntry[] = [];
  let fixedBrains = 0;
  let fixedHands = 0;

  for (const entry of queue) {
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
    seats: {
      w: { brain: brains[0], hand: hands[0] },
      b: { brain: brains[1], hand: hands[1] },
    },
    remaining: queue.filter((e) => !selectedIds.has(e.playerId)),
  };
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
