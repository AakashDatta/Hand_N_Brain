import { describe, expect, it } from 'vitest';
import { HandBrainGame } from '../engine';
import { Role } from '../engine';
import {
  actorFor,
  buildConfig,
  hasAiSeat,
  humanPerspective,
} from './seats';

describe('buildConfig presets', () => {
  it('hotseat: all four seats human', () => {
    const config = buildConfig('hotseat', 'w', 3);
    expect(config.seats.w).toEqual({ brain: 'human', hand: 'human' });
    expect(config.seats.b).toEqual({ brain: 'human', hand: 'human' });
    expect(hasAiSeat(config)).toBe(false);
  });

  it('vs-ai: opponent team fully AI', () => {
    const config = buildConfig('vs-ai', 'w', 3);
    expect(config.seats.w).toEqual({ brain: 'human', hand: 'human' });
    expect(config.seats.b).toEqual({ brain: 'ai', hand: 'ai' });
  });

  it('ai-brain: your Brain is AI, your Hand is you', () => {
    const config = buildConfig('ai-brain', 'b', 5);
    expect(config.seats.b).toEqual({ brain: 'ai', hand: 'human' });
    expect(config.seats.w).toEqual({ brain: 'ai', hand: 'ai' });
    expect(config.difficulty).toBe(5);
  });

  it('ai-hand: your Brain is you, your Hand is AI', () => {
    const config = buildConfig('ai-hand', 'w', 2);
    expect(config.seats.w).toEqual({ brain: 'human', hand: 'ai' });
    expect(config.seats.b).toEqual({ brain: 'ai', hand: 'ai' });
  });
});

describe('actorFor', () => {
  it('points at the side-to-move Brain, then Hand, then nobody', () => {
    const config = buildConfig('vs-ai', 'w', 3);
    const game = new HandBrainGame();

    let actor = actorFor(game.snapshot(), config);
    expect(actor).toEqual({ color: 'w', role: Role.Brain, controller: 'human' });

    game.selectPieceType('p');
    actor = actorFor(game.snapshot(), config);
    expect(actor).toEqual({ color: 'w', role: Role.Hand, controller: 'human' });

    game.selectMove(game.handMoves().find((m) => m.san === 'e4')!);
    actor = actorFor(game.snapshot(), config);
    expect(actor).toEqual({ color: 'b', role: Role.Brain, controller: 'ai' });
  });

  it('returns null when the game is over', () => {
    const config = buildConfig('hotseat', 'w', 3);
    const finished = new HandBrainGame('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
    expect(actorFor(finished.snapshot(), config)).toBeNull();
  });
});

describe('humanPerspective', () => {
  it('is null in hot-seat (no fixed perspective)', () => {
    expect(humanPerspective(buildConfig('hotseat', 'w', 3))).toBeNull();
  });

  it('faces the human team in every AI mode, both colors', () => {
    for (const mode of ['vs-ai', 'ai-brain', 'ai-hand'] as const) {
      expect(humanPerspective(buildConfig(mode, 'w', 3))).toBe('w');
      expect(humanPerspective(buildConfig(mode, 'b', 3))).toBe('b');
    }
  });
});
