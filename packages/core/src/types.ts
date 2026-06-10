/**
 * Core type definitions for the Hand and Brain turn protocol.
 *
 * These types describe a thin layer on top of chess.js. chess.js remains the
 * single source of truth for move generation, legality, and game-over
 * detection — nothing here reimplements chess rules.
 */

/** The six piece types, using chess.js's single-letter codes. */
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/** Side to move, using chess.js's codes. */
export type Color = 'w' | 'b';

/** Human-readable names for piece types, for UI display and messages. */
export const PIECE_TYPE_NAMES: Record<PieceType, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

/**
 * Whose turn it is to act within a single side's move.
 *
 * A side's move is split into two steps, mirroring the Hand and Brain
 * protocol exactly:
 *   AWAITING_BRAIN -> the Brain must name a piece type
 *   AWAITING_HAND  -> the Hand must move a piece of that type
 *   GAME_OVER      -> the game has ended; no further actions are legal
 */
export enum Phase {
  AwaitingBrain = 'AWAITING_BRAIN',
  AwaitingHand = 'AWAITING_HAND',
  GameOver = 'GAME_OVER',
}

/** The role a participant is filling on a side. */
export enum Role {
  Brain = 'BRAIN',
  Hand = 'HAND',
}

/**
 * A legal move, in the subset of chess.js's verbose move shape that the
 * Hand needs to choose and that the engine needs to apply.
 *
 * `from`/`to`/`promotion` uniquely identify the move to chess.js. We keep
 * `san` and `piece` for display and filtering.
 */
export interface LegalMove {
  /** Origin square, e.g. "e2". */
  from: string;
  /** Destination square, e.g. "e4". */
  to: string;
  /** The type of piece being moved. */
  piece: PieceType;
  /** Standard Algebraic Notation, e.g. "Nf3", "e8=Q", "O-O". */
  san: string;
  /** Promotion target piece type, present only for promotion moves. */
  promotion?: Exclude<PieceType, 'p' | 'k'>;
}

/** How the game ended, if it has. */
export enum GameOverReason {
  Checkmate = 'CHECKMATE',
  Stalemate = 'STALEMATE',
  ThreefoldRepetition = 'THREEFOLD_REPETITION',
  InsufficientMaterial = 'INSUFFICIENT_MATERIAL',
  FiftyMoveRule = 'FIFTY_MOVE_RULE',
  /** chess.js reports a draw without a more specific cause. */
  Draw = 'DRAW',
}

/** A snapshot of the result when the game is over. */
export interface GameResult {
  reason: GameOverReason;
  /** Winning side for a checkmate; null for any drawn outcome. */
  winner: Color | null;
}

/**
 * A complete, serializable view of the game state. The UI (and, later, a
 * network layer) renders from this snapshot rather than reaching into the
 * engine's internals.
 */
export interface GameSnapshot {
  /** Current position as FEN — the canonical board state. */
  fen: string;
  /** Side currently to move. */
  turn: Color;
  /** Which step of the protocol we are on. */
  phase: Phase;
  /** True if the side to move is in check. */
  inCheck: boolean;
  /**
   * Piece types the Brain may legally name this turn (each has >= 1 legal
   * move). Empty only when the game is over.
   */
  availablePieceTypes: PieceType[];
  /** The piece type the Brain named, once in AWAITING_HAND. */
  selectedPieceType: PieceType | null;
  /**
   * Legal moves the Hand may choose from, once a piece type is selected.
   * Empty until the Brain has named a type.
   */
  handMoves: LegalMove[];
  /** Move history in SAN, oldest first. */
  history: string[];
  /** From/to squares of the most recent move, for board highlighting. */
  lastMove: { from: string; to: string } | null;
  /** Populated when phase is GAME_OVER. */
  result: GameResult | null;
}
