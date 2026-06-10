import { describe, expect, it } from 'vitest';
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  buildGoCommand,
  difficultySettings,
  moveToUci,
  parseBestMoveLine,
  uciToMove,
} from './uci';

describe('UCI move encoding', () => {
  it('encodes plain and promotion moves', () => {
    expect(moveToUci({ from: 'e2', to: 'e4' })).toBe('e2e4');
    expect(moveToUci({ from: 'a7', to: 'a8', promotion: 'q' })).toBe('a7a8q');
  });

  it('decodes plain and promotion moves', () => {
    expect(uciToMove('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(uciToMove('a7a8n')).toEqual({ from: 'a7', to: 'a8', promotion: 'n' });
  });

  it('round-trips', () => {
    for (const uci of ['e2e4', 'g8f6', 'e1g1', 'h7h8r']) {
      expect(moveToUci(uciToMove(uci))).toBe(uci);
    }
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'e2', 'e2e9', 'i2e4', 'e2e4k', 'bestmove']) {
      expect(() => uciToMove(bad)).toThrow();
    }
  });
});

describe('parseBestMoveLine', () => {
  it('parses a bestmove line, with and without ponder', () => {
    expect(parseBestMoveLine('bestmove e2e4 ponder e7e5')).toEqual({
      from: 'e2',
      to: 'e4',
    });
    expect(parseBestMoveLine('bestmove a7a8q')).toEqual({
      from: 'a7',
      to: 'a8',
      promotion: 'q',
    });
  });

  it('returns null for non-bestmove lines', () => {
    expect(parseBestMoveLine('info depth 12 score cp 35')).toBeNull();
    expect(parseBestMoveLine('readyok')).toBeNull();
  });

  it('throws on "bestmove (none)" — we must never search a terminal position', () => {
    expect(() => parseBestMoveLine('bestmove (none)')).toThrow();
  });
});

describe('buildGoCommand', () => {
  it('builds a plain timed search', () => {
    expect(buildGoCommand(300)).toBe('go movetime 300');
  });

  it('restricts the search with searchmoves (the AI-Hand constraint)', () => {
    const command = buildGoCommand(300, [
      { from: 'g1', to: 'f3' },
      { from: 'b1', to: 'c3' },
    ]);
    expect(command).toBe('go movetime 300 searchmoves g1f3 b1c3');
  });

  it('omits searchmoves when the list is empty', () => {
    expect(buildGoCommand(300, [])).toBe('go movetime 300');
  });
});

describe('difficultySettings', () => {
  it('maps the full 1–8 range to valid Stockfish settings', () => {
    for (let level = MIN_DIFFICULTY; level <= MAX_DIFFICULTY; level++) {
      const { skillLevel, movetimeMs } = difficultySettings(level);
      expect(skillLevel).toBeGreaterThanOrEqual(0);
      expect(skillLevel).toBeLessThanOrEqual(20);
      expect(movetimeMs).toBeGreaterThan(0);
    }
  });

  it('is monotonically non-decreasing in strength', () => {
    for (let level = MIN_DIFFICULTY; level < MAX_DIFFICULTY; level++) {
      const lower = difficultySettings(level);
      const higher = difficultySettings(level + 1);
      expect(higher.skillLevel).toBeGreaterThanOrEqual(lower.skillLevel);
      expect(higher.movetimeMs).toBeGreaterThanOrEqual(lower.movetimeMs);
    }
  });

  it('clamps out-of-range levels instead of failing', () => {
    expect(difficultySettings(0)).toEqual(difficultySettings(MIN_DIFFICULTY));
    expect(difficultySettings(99)).toEqual(difficultySettings(MAX_DIFFICULTY));
  });
});
