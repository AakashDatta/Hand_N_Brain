/**
 * A single online match: four seats around one HandBrainGame.
 *
 * This class is the server's authority for one game. Every action is checked
 * twice: first that the sender actually occupies the seat whose turn it is
 * (never trust the client), then that the action is legal under the turn
 * protocol (the engine enforces this and throws ProtocolError otherwise).
 */
import {
  HandBrainGame,
  Phase,
  ProtocolError,
  Role,
  type ClockView,
  type Color,
  type ErrorCode,
  type GameSnapshot,
  type MatchOutcome,
  type PieceType,
} from '@hnb/core';
import { seatOf, type SeatPlan } from './matchmaking';

/** An action rejection with a protocol error code the client understands. */
export class MatchActionError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MatchActionError';
  }
}

/** Team time control: base bank plus a per-move (Fischer) increment. */
export interface ClockConfig {
  baseMs: number;
  incrementMs: number;
}

export class Match {
  readonly game = new HandBrainGame();
  /** Resignation, abandonment forfeit, or timeout — set once, final. */
  private terminalOverride: MatchOutcome | null = null;

  // Team clocks. Each team's Brain and Hand share one clock: it runs from
  // the moment their turn starts (Brain thinking included) until the Hand's
  // move is applied, then receives the increment. `activeSince` marks when
  // the side to move's clock started running.
  private readonly remainingMs: Record<Color, number> | null;
  private readonly incrementMs: number;
  private activeSince: number;

  constructor(
    public readonly id: string,
    public readonly seats: SeatPlan,
    clock?: ClockConfig,
    now: number = Date.now(),
  ) {
    this.remainingMs = clock ? { w: clock.baseMs, b: clock.baseMs } : null;
    this.incrementMs = clock?.incrementMs ?? 0;
    this.activeSince = now;
  }

  snapshot(): GameSnapshot {
    return this.game.snapshot();
  }

  seatOfPlayer(playerId: string): { color: Color; role: Role } | null {
    return seatOf(this.seats, playerId);
  }

  /** The match outcome: an override, the position's result, or null. */
  outcome(): MatchOutcome | null {
    if (this.terminalOverride) return this.terminalOverride;
    const result = this.game.result();
    return result ? { winner: result.winner, by: result.reason } : null;
  }

  // ---------------------------------------------------------------------------
  // Clocks
  // ---------------------------------------------------------------------------

  /** Clock state as of `now`, for broadcasting. Null for untimed matches. */
  clockView(now: number = Date.now()): ClockView | null {
    if (!this.remainingMs) return null;
    const finished = this.isFinished();
    const view: ClockView = {
      remaining: { ...this.remainingMs },
      running: finished ? null : this.game.turn,
    };
    if (!finished) {
      const turn = this.game.turn;
      view.remaining[turn] = Math.max(0, view.remaining[turn] - (now - this.activeSince));
    }
    return view;
  }

  /** Milliseconds until the running side flags, or null (untimed/finished). */
  msUntilFlag(now: number = Date.now()): number | null {
    const view = this.clockView(now);
    return view?.running ? view.remaining[view.running] : null;
  }

  /**
   * Declare the running side flagged if its bank is empty. Returns whether
   * the match just ended on time. Safe to call speculatively from timers.
   */
  checkTimeout(now: number = Date.now()): boolean {
    if (!this.remainingMs || this.isFinished()) return false;
    if (this.msUntilFlag(now)! > 0) return false;
    const flagged = this.game.turn;
    this.remainingMs[flagged] = 0;
    this.terminalOverride = {
      winner: flagged === 'w' ? 'b' : 'w',
      by: 'timeout',
    };
    return true;
  }

  /** Settle the mover's clock after a completed move: deduct, add increment. */
  private settleClockAfterMove(mover: Color, now: number): void {
    if (!this.remainingMs) return;
    const elapsed = now - this.activeSince;
    this.remainingMs[mover] = Math.max(
      0,
      this.remainingMs[mover] - elapsed + this.incrementMs,
    );
    this.activeSince = now; // the other side's clock starts now
  }

  isFinished(): boolean {
    return this.outcome() !== null;
  }

  /** The Brain names a piece type. Validates seat ownership, then legality. */
  selectPieceType(playerId: string, pieceType: PieceType, now: number = Date.now()): void {
    if (this.checkTimeout(now)) return; // flag fell first; caller broadcasts
    this.requireActor(playerId, Role.Brain);
    try {
      this.game.selectPieceType(pieceType);
    } catch (error) {
      throw toActionError(error);
    }
  }

  /** The Hand plays a move. Validates seat ownership, then legality. */
  selectMove(
    playerId: string,
    move: { from: string; to: string; promotion?: Exclude<PieceType, 'p' | 'k'> },
    now: number = Date.now(),
  ): void {
    if (this.checkTimeout(now)) return; // flag fell first; caller broadcasts
    this.requireActor(playerId, Role.Hand);
    const mover = this.game.turn;
    try {
      this.game.selectMove(move);
    } catch (error) {
      throw toActionError(error);
    }
    this.settleClockAfterMove(mover, now);
  }

  /**
   * Either member of a team may resign on its behalf (standard practice for
   * team chess). Resigning a finished match is rejected.
   */
  resign(playerId: string): void {
    if (this.isFinished()) {
      throw new MatchActionError('illegal-action', 'The match is already over.');
    }
    const seat = this.seatOfPlayer(playerId);
    if (!seat) {
      throw new MatchActionError('not-in-match', 'You are not in this match.');
    }
    this.terminalOverride = {
      winner: seat.color === 'w' ? 'b' : 'w',
      by: 'resignation',
    };
  }

  /** Forfeit a team without a player action (e.g. abandonment timeout). */
  forfeit(color: Color): void {
    if (this.isFinished()) return;
    this.terminalOverride = { winner: color === 'w' ? 'b' : 'w', by: 'resignation' };
  }

  /**
   * Reject the action unless the sender occupies the exact seat the protocol
   * is waiting on: the side to move's Brain in AWAITING_BRAIN, its Hand in
   * AWAITING_HAND.
   */
  private requireActor(playerId: string, expectedRole: Role): void {
    if (this.isFinished()) {
      throw new MatchActionError('illegal-action', 'The match is already over.');
    }
    const seat = this.seatOfPlayer(playerId);
    if (!seat) {
      throw new MatchActionError('not-in-match', 'You are not in this match.');
    }

    const phase = this.game.currentPhase;
    const actingRole =
      phase === Phase.AwaitingBrain ? Role.Brain : Role.Hand;
    if (
      seat.color !== this.game.turn ||
      seat.role !== expectedRole ||
      actingRole !== expectedRole
    ) {
      throw new MatchActionError(
        'not-your-turn',
        'It is not your seat\'s turn to act.',
      );
    }
  }
}

function toActionError(error: unknown): MatchActionError {
  if (error instanceof ProtocolError) {
    return new MatchActionError('illegal-action', error.message);
  }
  throw error;
}
