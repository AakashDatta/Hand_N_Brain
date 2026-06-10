/**
 * Pure helpers for speaking UCI to Stockfish. Kept free of Worker/DOM
 * dependencies so they can be unit-tested directly.
 */
import type { LegalMove } from '@hnb/core';

/** A move in UCI long algebraic notation parts, e.g. e2->e4 or a7->a8=q. */
export interface UciMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

/** Encode a move as UCI long algebraic notation, e.g. "e2e4", "a7a8q". */
export function moveToUci(move: UciMove): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/** Decode UCI long algebraic notation into from/to/promotion parts. */
export function uciToMove(uci: string): UciMove {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error(`Not a UCI move: "${uci}"`);
  }
  const move: UciMove = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  if (uci.length === 5) {
    move.promotion = uci[4] as UciMove['promotion'];
  }
  return move;
}

/**
 * Parse an engine output line. Returns the best move if the line is a
 * "bestmove" line, null for every other line (info, id, etc.).
 *
 * "bestmove (none)" (no legal move — should never be reached, since we never
 * search a terminal position) is reported as an explicit error.
 */
export function parseBestMoveLine(line: string): UciMove | null {
  const match = line.match(/^bestmove\s+(\S+)/);
  if (!match) return null;
  if (match[1] === '(none)') {
    throw new Error('Engine reported no legal move (searched a terminal position?)');
  }
  return uciToMove(match[1]);
}

/**
 * Build the "go" command for a search, optionally restricted to a subset of
 * root moves. `searchmoves` is how the AI Hand obeys the Brain: the engine is
 * only allowed to consider the legal moves of the named piece type.
 */
export function buildGoCommand(movetimeMs: number, searchMoves?: UciMove[]): string {
  let command = `go movetime ${movetimeMs}`;
  if (searchMoves && searchMoves.length > 0) {
    command += ` searchmoves ${searchMoves.map(moveToUci).join(' ')}`;
  }
  return command;
}

/** Convert an engine LegalMove to UCI parts (the shapes are compatible). */
export function legalMoveToUci(move: LegalMove): UciMove {
  return { from: move.from, to: move.to, promotion: move.promotion };
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

/**
 * Difficulty is a 1–8 scale mapped to Stockfish's Skill Level (0–20, which
 * injects deliberate inaccuracies at low values) plus a time budget. The
 * mapping is deliberately isolated here so it is easy to retune.
 */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 8;

export interface SearchSettings {
  /** Stockfish "Skill Level" option, 0 (weakest) to 20 (full strength). */
  skillLevel: number;
  /** Time budget per search in milliseconds. */
  movetimeMs: number;
}

const DIFFICULTY_TABLE: Record<number, SearchSettings> = {
  1: { skillLevel: 0, movetimeMs: 80 },
  2: { skillLevel: 3, movetimeMs: 120 },
  3: { skillLevel: 6, movetimeMs: 200 },
  4: { skillLevel: 10, movetimeMs: 300 },
  5: { skillLevel: 14, movetimeMs: 500 },
  6: { skillLevel: 17, movetimeMs: 800 },
  7: { skillLevel: 20, movetimeMs: 1200 },
  8: { skillLevel: 20, movetimeMs: 2500 },
};

export function difficultySettings(level: number): SearchSettings {
  const clamped = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.round(level)));
  return DIFFICULTY_TABLE[clamped];
}
