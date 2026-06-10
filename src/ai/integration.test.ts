import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { HandBrainGame, Phase } from '../engine';
import { pieceTypeAtSquare } from './position';
import {
  buildGoCommand,
  difficultySettings,
  legalMoveToUci,
  parseBestMoveLine,
  type UciMove,
} from './uci';

/**
 * Integration test: drive a real Stockfish (the same lite-single WASM build
 * the browser uses, loaded through the package's Node wrapper) through the
 * Hand and Brain protocol, exactly as useAiSeats does in the browser:
 *
 *   Brain step: full search -> announce only the piece type of the best move.
 *   Hand step:  search restricted via `searchmoves` to that type's moves.
 *
 * This verifies the UCI command building, bestmove parsing, and protocol
 * integration end to end. Only the transport differs from the browser
 * (Node callback API instead of a Web Worker).
 */

interface NodeEngine {
  sendCommand: (command: string) => void;
  listener: ((line: string) => void) | null;
  terminate: () => void;
}

let engine: NodeEngine;
let pendingResolve: ((line: string) => void) | null = null;
let pendingMatch: ((line: string) => boolean) | null = null;

function send(command: string): void {
  engine.sendCommand(command);
}

function waitForLine(matches: (line: string) => boolean): Promise<string> {
  return new Promise((resolve) => {
    pendingMatch = matches;
    pendingResolve = resolve;
  });
}

async function searchBestMove(
  fen: string,
  difficulty: number,
  searchMoves?: UciMove[],
): Promise<UciMove> {
  const { skillLevel, movetimeMs } = difficultySettings(difficulty);
  send(`setoption name Skill Level value ${skillLevel}`);
  send(`position fen ${fen}`);
  send(buildGoCommand(movetimeMs, searchMoves));
  const line = await waitForLine((l) => l.startsWith('bestmove'));
  const move = parseBestMoveLine(line);
  if (!move) throw new Error(`Unparseable: ${line}`);
  return move;
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const initEngine = require('stockfish');
  engine = await initEngine('lite-single');
  engine.listener = (line: string) => {
    if (pendingMatch?.(line)) {
      const resolve = pendingResolve!;
      pendingMatch = null;
      pendingResolve = null;
      resolve(line);
    }
  };
  send('uci');
  await waitForLine((l) => l === 'uciok');
  send('isready');
  await waitForLine((l) => l === 'readyok');
}, 30_000);

afterAll(() => {
  engine?.terminate?.();
});

describe('Stockfish through the Hand and Brain protocol', () => {
  it('plays a full AI-vs-AI stretch with per-step Brain/Hand searches', async () => {
    const game = new HandBrainGame();
    const difficulty = 1; // fastest searches; strength is irrelevant here

    for (let ply = 0; ply < 12 && !game.isGameOver(); ply++) {
      // --- Brain step: full search, announce only the piece type. ---
      const brainPreference = await searchBestMove(game.fen, difficulty);
      const announcedType = pieceTypeAtSquare(game.fen, brainPreference.from);
      expect(announcedType).not.toBeNull();
      expect(game.availablePieceTypes()).toContain(announcedType);
      game.selectPieceType(announcedType!);

      // --- Hand step: search restricted to the announced type's moves. ---
      const allowed = game.handMoves();
      expect(allowed.length).toBeGreaterThan(0);
      const handChoice = await searchBestMove(
        game.fen,
        difficulty,
        allowed.map(legalMoveToUci),
      );

      // The engine must respect the searchmoves restriction.
      const match = allowed.find(
        (m) =>
          m.from === handChoice.from &&
          m.to === handChoice.to &&
          m.promotion === handChoice.promotion,
      );
      expect(match).toBeDefined();

      game.selectMove(match!);
      expect([Phase.AwaitingBrain, Phase.GameOver]).toContain(
        game.currentPhase,
      );
    }

    expect(game.snapshot().history.length).toBeGreaterThanOrEqual(12);
  }, 60_000);

  it('respects a single-move searchmoves restriction exactly', async () => {
    // Force the engine's hand: restrict to one (bad) move and require it.
    const best = await searchBestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1, [
      { from: 'a2', to: 'a3' },
    ]);
    expect(best).toEqual({ from: 'a2', to: 'a3' });
  });
});
