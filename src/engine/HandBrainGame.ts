import { Chess } from 'chess.js';
import type { Move as ChessJsMove } from 'chess.js';
import {
  GameOverReason,
  Phase,
  type Color,
  type GameResult,
  type GameSnapshot,
  type LegalMove,
  type PieceType,
} from './types';

/**
 * The Hand and Brain turn protocol, implemented as a thin layer over chess.js.
 *
 * chess.js is the single source of truth for move generation, legality, and
 * game-over detection. This class never reasons about chess rules directly; it
 * only orchestrates the two-step "Brain names a type, Hand moves that type"
 * protocol on top of chess.js's legal-move list.
 *
 * The protocol, implemented in exactly this order (see README / brief):
 *   1. Compute all legal moves for the side to move (chess.js).
 *   2. Derive the set of piece types with >= 1 legal move.
 *   3. Brain picks one type from that set (validated here).
 *   4. Filter legal moves to that piece type; expose them to the Hand.
 *   5. Hand picks one move from the filtered set (validated here).
 *   6. Apply move, switch sides.
 *
 * Ordering legal-moves-first makes every edge case fall out for free:
 *   - Check: only check-resolving moves are legal, so types that cannot
 *     resolve check never appear as Brain options.
 *   - Castling: a king move. En passant: a pawn move. Promotion: a pawn move
 *     where the Hand also chooses the promotion target.
 *   - Checkmate / stalemate / draws: detected via chess.js's game-over state.
 */
export class HandBrainGame {
  private readonly chess: Chess;
  private phase: Phase;
  private selectedPieceType: PieceType | null = null;

  /**
   * @param fen Optional starting position. Defaults to the standard initial
   *            position. Useful for tests and for loading saved games.
   */
  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
    this.phase = this.chess.isGameOver() ? Phase.GameOver : Phase.AwaitingBrain;
  }

  // ---------------------------------------------------------------------------
  // Step 1 & 2: legal moves -> available piece types
  // ---------------------------------------------------------------------------

  /**
   * The piece types the Brain may name this turn: every type that has at least
   * one legal move in the current position. Returned in a stable order.
   *
   * This is the guarantee behind "the Brain can never name a type with no
   * legal move" — the only types ever offered are derived from the legal-move
   * list itself.
   */
  availablePieceTypes(): PieceType[] {
    if (this.phase === Phase.GameOver) return [];

    const types = new Set<PieceType>();
    for (const move of this.allLegalMoves()) {
      types.add(move.piece as PieceType);
    }
    return ORDERED_PIECE_TYPES.filter((t) => types.has(t));
  }

  // ---------------------------------------------------------------------------
  // Step 3: Brain names a type
  // ---------------------------------------------------------------------------

  /**
   * The Brain names a piece type. The server validates that the type is a
   * member of {@link availablePieceTypes}; naming a type with no legal move is
   * rejected and leaves the game state unchanged.
   *
   * Transitions AWAITING_BRAIN -> AWAITING_HAND.
   */
  selectPieceType(pieceType: PieceType): void {
    if (this.phase !== Phase.AwaitingBrain) {
      throw new ProtocolError(
        `Cannot select a piece type while phase is ${this.phase}.`,
      );
    }
    if (!this.availablePieceTypes().includes(pieceType)) {
      throw new ProtocolError(
        `"${pieceType}" has no legal move and cannot be named by the Brain.`,
      );
    }
    this.selectedPieceType = pieceType;
    this.phase = Phase.AwaitingHand;
  }

  /**
   * Undo the Brain's selection before the Hand has moved, returning to
   * AWAITING_BRAIN. This is a local convenience (e.g. a "back" button in
   * hot-seat play); since no move has been applied, it reveals nothing and
   * does not alter the position.
   */
  clearPieceTypeSelection(): void {
    if (this.phase !== Phase.AwaitingHand) {
      throw new ProtocolError(
        `No piece-type selection to clear (phase is ${this.phase}).`,
      );
    }
    this.selectedPieceType = null;
    this.phase = Phase.AwaitingBrain;
  }

  // ---------------------------------------------------------------------------
  // Step 4: filtered moves for the Hand
  // ---------------------------------------------------------------------------

  /**
   * The legal moves the Hand may choose from: all legal moves of the piece
   * type the Brain named. Empty until a type has been selected.
   */
  handMoves(): LegalMove[] {
    if (this.phase !== Phase.AwaitingHand || this.selectedPieceType === null) {
      return [];
    }
    return this.allLegalMoves()
      .filter((m) => m.piece === this.selectedPieceType)
      .map(toLegalMove);
  }

  // ---------------------------------------------------------------------------
  // Step 5 & 6: Hand moves, sides switch
  // ---------------------------------------------------------------------------

  /**
   * The Hand chooses a move. The move is validated against the filtered set
   * (it must be a legal move of the named piece type). On success the move is
   * applied, the side switches, and the phase returns to AWAITING_BRAIN — or
   * GAME_OVER if the move ended the game.
   *
   * A move is identified by from/to and, for promotions, the promotion target.
   *
   * @returns The applied move in SAN.
   */
  selectMove(move: {
    from: string;
    to: string;
    promotion?: LegalMove['promotion'];
  }): string {
    if (this.phase !== Phase.AwaitingHand) {
      throw new ProtocolError(
        `Cannot make a move while phase is ${this.phase}.`,
      );
    }

    const candidate = this.handMoves().find(
      (m) =>
        m.from === move.from &&
        m.to === move.to &&
        m.promotion === move.promotion,
    );
    if (!candidate) {
      throw new ProtocolError(
        `Move ${move.from}-${move.to}${
          move.promotion ? '=' + move.promotion : ''
        } is not a legal move of the named piece type.`,
      );
    }

    // Safe by construction: candidate came from chess.js's own legal moves.
    const applied = this.chess.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion,
    });

    this.selectedPieceType = null;
    this.phase = this.chess.isGameOver() ? Phase.GameOver : Phase.AwaitingBrain;
    return applied.san;
  }

  // ---------------------------------------------------------------------------
  // State inspection
  // ---------------------------------------------------------------------------

  get currentPhase(): Phase {
    return this.phase;
  }

  get turn(): Color {
    return this.chess.turn();
  }

  get fen(): string {
    return this.chess.fen();
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  /**
   * The result of the game, or null if it is still in progress. The winner of
   * a checkmate is the side that just moved (i.e. the opposite of the side now
   * to move, which has no legal reply).
   */
  result(): GameResult | null {
    if (!this.chess.isGameOver()) return null;

    if (this.chess.isCheckmate()) {
      return {
        reason: GameOverReason.Checkmate,
        winner: this.chess.turn() === 'w' ? 'b' : 'w',
      };
    }
    if (this.chess.isStalemate()) {
      return { reason: GameOverReason.Stalemate, winner: null };
    }
    if (this.chess.isInsufficientMaterial()) {
      return { reason: GameOverReason.InsufficientMaterial, winner: null };
    }
    if (this.chess.isThreefoldRepetition()) {
      return { reason: GameOverReason.ThreefoldRepetition, winner: null };
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return { reason: GameOverReason.FiftyMoveRule, winner: null };
    }
    return { reason: GameOverReason.Draw, winner: null };
  }

  /**
   * A complete, serializable snapshot of the current state. UI and network
   * layers render from this rather than reaching into engine internals.
   */
  snapshot(): GameSnapshot {
    return {
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      phase: this.phase,
      inCheck: this.chess.isCheck(),
      availablePieceTypes: this.availablePieceTypes(),
      selectedPieceType: this.selectedPieceType,
      handMoves: this.handMoves(),
      history: this.chess.history(),
      result: this.result(),
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** All legal moves for the side to move, in chess.js's verbose form. */
  private allLegalMoves(): ChessJsMove[] {
    return this.chess.moves({ verbose: true });
  }
}

/** Thrown when an action violates the Hand and Brain turn protocol. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Display/selection order for piece types. */
const ORDERED_PIECE_TYPES: PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];

function toLegalMove(m: ChessJsMove): LegalMove {
  return {
    from: m.from,
    to: m.to,
    piece: m.piece as PieceType,
    san: m.san,
    promotion: m.promotion as LegalMove['promotion'],
  };
}
