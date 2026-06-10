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

export class Match {
  readonly game = new HandBrainGame();
  private resignation: MatchOutcome | null = null;

  constructor(
    public readonly id: string,
    public readonly seats: SeatPlan,
  ) {}

  snapshot(): GameSnapshot {
    return this.game.snapshot();
  }

  seatOfPlayer(playerId: string): { color: Color; role: Role } | null {
    return seatOf(this.seats, playerId);
  }

  /** The match outcome: resignation, the position's result, or null. */
  outcome(): MatchOutcome | null {
    if (this.resignation) return this.resignation;
    const result = this.game.result();
    return result ? { winner: result.winner, by: result.reason } : null;
  }

  isFinished(): boolean {
    return this.outcome() !== null;
  }

  /** The Brain names a piece type. Validates seat ownership, then legality. */
  selectPieceType(playerId: string, pieceType: PieceType): void {
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
  ): void {
    this.requireActor(playerId, Role.Hand);
    try {
      this.game.selectMove(move);
    } catch (error) {
      throw toActionError(error);
    }
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
    this.resignation = {
      winner: seat.color === 'w' ? 'b' : 'w',
      by: 'resignation',
    };
  }

  /** Forfeit a team without a player action (e.g. abandonment timeout). */
  forfeit(color: Color): void {
    if (this.isFinished()) return;
    this.resignation = { winner: color === 'w' ? 'b' : 'w', by: 'resignation' };
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
