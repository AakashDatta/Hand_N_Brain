import { describe, expect, it } from 'vitest';
import { Match, MatchActionError } from './match';
import type { SeatPlan } from './matchmaking';

const SEATS: SeatPlan = {
  w: { brain: 'wb', hand: 'wh' },
  b: { brain: 'bb', hand: 'bh' },
};

function newMatch(): Match {
  return new Match('m1', SEATS);
}

describe('seat authority', () => {
  it('only the side-to-move Brain may name a type', () => {
    const match = newMatch();
    // Not these players' turn / role:
    for (const wrong of ['wh', 'bb', 'bh']) {
      expect(() => match.selectPieceType(wrong, 'p')).toThrow(MatchActionError);
    }
    // A stranger is rejected with not-in-match:
    expect(() => match.selectPieceType('intruder', 'p')).toThrow(
      expect.objectContaining({ code: 'not-in-match' }),
    );
    // The right seat works:
    match.selectPieceType('wb', 'p');
  });

  it('only the side-to-move Hand may move, and only after the Brain', () => {
    const match = newMatch();
    // Hand cannot act before the Brain has named a type.
    expect(() =>
      match.selectMove('wh', { from: 'e2', to: 'e4' }),
    ).toThrow(expect.objectContaining({ code: 'not-your-turn' }));

    match.selectPieceType('wb', 'p');
    // The Brain cannot move for the Hand.
    expect(() =>
      match.selectMove('wb', { from: 'e2', to: 'e4' }),
    ).toThrow(expect.objectContaining({ code: 'not-your-turn' }));

    match.selectMove('wh', { from: 'e2', to: 'e4' });
    expect(match.snapshot().turn).toBe('b');
  });

  it('engine illegality surfaces as illegal-action', () => {
    const match = newMatch();
    expect(() => match.selectPieceType('wb', 'q')).toThrow(
      expect.objectContaining({ code: 'illegal-action' }),
    );
    match.selectPieceType('wb', 'n');
    expect(() =>
      match.selectMove('wh', { from: 'e2', to: 'e4' }),
    ).toThrow(expect.objectContaining({ code: 'illegal-action' }));
  });
});

describe('outcomes', () => {
  it('reports checkmate through the engine result', () => {
    const match = newMatch();
    const play = (brain: string, hand: string, type: Parameters<Match['selectPieceType']>[1], from: string, to: string) => {
      match.selectPieceType(brain, type);
      match.selectMove(hand, { from, to });
    };
    // Fool's mate.
    play('wb', 'wh', 'p', 'f2', 'f3');
    play('bb', 'bh', 'p', 'e7', 'e5');
    play('wb', 'wh', 'p', 'g2', 'g4');
    play('bb', 'bh', 'q', 'd8', 'h4');

    expect(match.isFinished()).toBe(true);
    expect(match.outcome()).toEqual({ winner: 'b', by: 'CHECKMATE' });
    // No further actions are accepted.
    expect(() => match.selectPieceType('wb', 'k')).toThrow(
      expect.objectContaining({ code: 'illegal-action' }),
    );
  });

  it('either team member may resign for the team', () => {
    const handResigns = newMatch();
    handResigns.resign('wh');
    expect(handResigns.outcome()).toEqual({ winner: 'b', by: 'resignation' });

    const brainResigns = newMatch();
    brainResigns.resign('bb');
    expect(brainResigns.outcome()).toEqual({ winner: 'w', by: 'resignation' });
  });

  it('rejects resignation from outsiders and after the match ends', () => {
    const match = newMatch();
    expect(() => match.resign('intruder')).toThrow(
      expect.objectContaining({ code: 'not-in-match' }),
    );
    match.resign('wh');
    expect(() => match.resign('bb')).toThrow(
      expect.objectContaining({ code: 'illegal-action' }),
    );
  });

  it('forfeit awards the win to the other team', () => {
    const match = newMatch();
    match.forfeit('b');
    expect(match.outcome()).toEqual({ winner: 'w', by: 'resignation' });
  });
});
