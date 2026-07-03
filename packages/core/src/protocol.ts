/**
 * The client/server wire protocol for online play, shared by the web client
 * and the authoritative server so the two can never drift apart.
 *
 * Every message is a JSON object with a `type` discriminant. The server
 * validates every inbound message structurally (parseClientMessage) before
 * acting on it, and validates every game action against the engine — the
 * client is never trusted for legality.
 */
import type { Color, GameOverReason, GameSnapshot, PieceType } from './types';
import { Role } from './types';
import type { RatingState } from './elo';

/** A queueing player's role preference. */
export type QueueRole = 'hand' | 'brain' | 'either';

/** A player's two independent role ratings. */
export interface PlayerRatings {
  hand: RatingState;
  brain: RatingState;
}

/** One row of a role leaderboard. */
export interface LeaderboardEntry {
  playerId: string;
  name: string;
  rating: number;
  gamesPlayed: number;
}

/** A finished match as it appears in someone's history. */
export interface MatchHistoryEntry {
  matchId: string;
  endedAt: number;
  /** This player's seat in that match. */
  seat: SeatAssignment;
  outcome: MatchOutcome;
  opponents: string[];
  teammate: string;
  moveCount: number;
}

/** Which seat a player occupies in a match. */
export interface SeatAssignment {
  color: Color;
  role: Role;
}

/** Public information about a participant in a match. */
export interface MatchPlayerInfo {
  playerId: string;
  name: string;
  seat: SeatAssignment;
  connected: boolean;
}

/** How a finished match ended. Resignation and timeout are match-level
 *  outcomes that the chess position itself cannot express. */
export interface MatchOutcome {
  winner: Color | null;
  by: GameOverReason | 'resignation' | 'timeout';
}

/**
 * A team clock snapshot at the moment a message was sent. Each team's Brain
 * and Hand share one clock; it runs from the start of their turn (Brain
 * thinking included) until the Hand's move lands, then gains the increment.
 */
export interface ClockView {
  /** Milliseconds remaining per team, as of this message. */
  remaining: Record<Color, number>;
  /** Whose clock is currently running; null once the match is over. */
  running: Color | null;
}

/** A member of a private room and the seat they have claimed, if any. */
export interface RoomMemberInfo {
  playerId: string;
  name: string;
  connected: boolean;
  seat: SeatAssignment | null;
}

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
  /** First message on every connection. Reconnecting clients present their
   *  token to be re-attached to their identity and any active match. */
  | { type: 'hello'; token?: string; name?: string }
  | { type: 'set-name'; name: string }
  | { type: 'queue-join'; role: QueueRole }
  | { type: 'queue-leave' }
  | { type: 'select-piece-type'; matchId: string; pieceType: PieceType }
  | {
      type: 'select-move';
      matchId: string;
      from: string;
      to: string;
      promotion?: Exclude<PieceType, 'p' | 'k'>;
    }
  | { type: 'resign'; matchId: string }
  | { type: 'get-leaderboard' }
  | { type: 'get-profile' }
  /** Private rooms: create/join by code, claim a seat, start when full. */
  | { type: 'room-create' }
  | { type: 'room-join'; code: string }
  | { type: 'room-seat'; color: Color; role: Role }
  | { type: 'room-unseat' }
  | { type: 'room-leave' }
  | { type: 'room-start' };

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | {
      type: 'welcome';
      playerId: string;
      /** Session token the client must persist and present on reconnect. */
      token: string;
      name: string;
      /** Set when the player reconnected while a match was in progress. */
      activeMatchId: string | null;
      ratings: PlayerRatings;
    }
  | { type: 'queue-status'; queued: boolean; role?: QueueRole }
  | {
      type: 'match-found';
      matchId: string;
      yourSeat: SeatAssignment;
      players: MatchPlayerInfo[];
    }
  | {
      type: 'match-state';
      matchId: string;
      snapshot: GameSnapshot;
      players: MatchPlayerInfo[];
      outcome: MatchOutcome | null;
      /** Team clocks, or null for an untimed match. */
      clock: ClockView | null;
    }
  | {
      /** Full state of the private room a player is in; sent on every change. */
      type: 'room-state';
      code: string;
      hostId: string;
      members: RoomMemberInfo[];
    }
  | {
      type: 'player-connection';
      matchId: string;
      playerId: string;
      connected: boolean;
    }
  | {
      /** Sent to each participant after a rated match: their role rating change. */
      type: 'rating-update';
      matchId: string;
      role: Role;
      before: RatingState;
      after: RatingState;
    }
  | {
      type: 'leaderboard';
      hand: LeaderboardEntry[];
      brain: LeaderboardEntry[];
    }
  | {
      type: 'profile';
      playerId: string;
      name: string;
      ratings: PlayerRatings;
      history: MatchHistoryEntry[];
    }
  | { type: 'error-message'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'bad-message'
  | 'not-in-match'
  | 'not-your-turn'
  | 'illegal-action'
  | 'already-queued'
  | 'no-such-room'
  | 'room-full'
  | 'seat-taken'
  | 'not-host'
  | 'room-not-ready';

// ---------------------------------------------------------------------------
// Inbound validation
// ---------------------------------------------------------------------------

const PIECE_TYPES: readonly string[] = ['p', 'n', 'b', 'r', 'q', 'k'];
const PROMOTION_TYPES: readonly string[] = ['q', 'r', 'b', 'n'];
const QUEUE_ROLES: readonly string[] = ['hand', 'brain', 'either'];
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const MAX_NAME_LENGTH = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Trim and bound a display name; returns null if nothing usable remains. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse and structurally validate a raw inbound payload. Returns null for
 * anything malformed — the caller replies with a 'bad-message' error. This is
 * the first of the server's two validation layers (the second is the engine
 * itself, which rules on game legality).
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;

  switch (value.type) {
    case 'hello': {
      const message: ClientMessage = { type: 'hello' };
      if (isNonEmptyString(value.token)) message.token = value.token;
      const name = sanitizeName(value.name);
      if (name) message.name = name;
      return message;
    }
    case 'set-name': {
      const name = sanitizeName(value.name);
      return name ? { type: 'set-name', name } : null;
    }
    case 'queue-join': {
      if (typeof value.role !== 'string' || !QUEUE_ROLES.includes(value.role)) {
        return null;
      }
      return { type: 'queue-join', role: value.role as QueueRole };
    }
    case 'queue-leave':
      return { type: 'queue-leave' };
    case 'select-piece-type': {
      if (!isNonEmptyString(value.matchId)) return null;
      if (
        typeof value.pieceType !== 'string' ||
        !PIECE_TYPES.includes(value.pieceType)
      ) {
        return null;
      }
      return {
        type: 'select-piece-type',
        matchId: value.matchId,
        pieceType: value.pieceType as PieceType,
      };
    }
    case 'select-move': {
      if (!isNonEmptyString(value.matchId)) return null;
      if (
        typeof value.from !== 'string' ||
        !SQUARE_PATTERN.test(value.from) ||
        typeof value.to !== 'string' ||
        !SQUARE_PATTERN.test(value.to)
      ) {
        return null;
      }
      const message: ClientMessage = {
        type: 'select-move',
        matchId: value.matchId,
        from: value.from,
        to: value.to,
      };
      if (value.promotion !== undefined) {
        if (
          typeof value.promotion !== 'string' ||
          !PROMOTION_TYPES.includes(value.promotion)
        ) {
          return null;
        }
        message.promotion = value.promotion as Exclude<PieceType, 'p' | 'k'>;
      }
      return message;
    }
    case 'resign': {
      if (!isNonEmptyString(value.matchId)) return null;
      return { type: 'resign', matchId: value.matchId };
    }
    case 'room-create':
      return { type: 'room-create' };
    case 'room-join': {
      const code = normalizeRoomCode(value.code);
      return code ? { type: 'room-join', code } : null;
    }
    case 'room-seat': {
      if (value.color !== 'w' && value.color !== 'b') return null;
      if (value.role !== Role.Brain && value.role !== Role.Hand) return null;
      return { type: 'room-seat', color: value.color, role: value.role };
    }
    case 'room-unseat':
      return { type: 'room-unseat' };
    case 'room-leave':
      return { type: 'room-leave' };
    case 'room-start':
      return { type: 'room-start' };
    case 'get-leaderboard':
      return { type: 'get-leaderboard' };
    case 'get-profile':
      return { type: 'get-profile' };
    default:
      return null;
  }
}

/**
 * Normalize a user-typed room code: uppercase, strip whitespace/dashes.
 * Returns null unless the result is 4-8 characters of A-Z / 2-9.
 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z2-9]{4,8}$/.test(code) ? code : null;
}
