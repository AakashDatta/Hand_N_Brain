import { Chess, type Square } from 'chess.js';
import type { PieceType } from '../engine';

/**
 * The piece type standing on a square, read authoritatively via chess.js.
 *
 * Used to turn the engine's preferred move into a Brain announcement: the AI
 * Brain searches the full position, then announces only the *type* of the
 * piece its best move would play — exactly the single piece-type bit a human
 * Brain is allowed to communicate.
 */
export function pieceTypeAtSquare(fen: string, square: string): PieceType | null {
  const piece = new Chess(fen).get(square as Square);
  return piece ? (piece.type as PieceType) : null;
}
