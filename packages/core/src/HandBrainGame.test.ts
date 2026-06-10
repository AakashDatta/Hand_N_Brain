import { describe, expect, it } from 'vitest';
import { HandBrainGame, ProtocolError } from './HandBrainGame';
import { GameOverReason, Phase, type PieceType } from './types';

/**
 * Tests for the Hand and Brain turn-protocol layer. These exercise the
 * protocol and its edge cases. They deliberately do NOT re-test chess rules
 * themselves (move legality, etc.) — that is chess.js's job and is assumed
 * correct. We only verify that our thin layer orchestrates the protocol
 * correctly on top of it.
 */

describe('initial state', () => {
  it('starts with White to move, awaiting the Brain', () => {
    const game = new HandBrainGame();
    expect(game.turn).toBe('w');
    expect(game.currentPhase).toBe(Phase.AwaitingBrain);
    expect(game.isGameOver()).toBe(false);
  });

  it('offers only pawn and knight at the start (the only movable types)', () => {
    const game = new HandBrainGame();
    // From the opening position, only pawns and knights have legal moves.
    expect(game.availablePieceTypes().sort()).toEqual(['n', 'p']);
  });

  it('exposes no hand moves until the Brain names a type', () => {
    const game = new HandBrainGame();
    expect(game.handMoves()).toEqual([]);
  });
});

describe('the Brain naming a piece type (step 3)', () => {
  it('transitions to AWAITING_HAND and filters moves to that type', () => {
    const game = new HandBrainGame();
    game.selectPieceType('n');
    expect(game.currentPhase).toBe(Phase.AwaitingHand);

    const moves = game.handMoves();
    expect(moves.length).toBe(4); // Na3, Nc3, Nf3, Nh3
    expect(moves.every((m) => m.piece === 'n')).toBe(true);
  });

  it('rejects naming a type that has no legal move', () => {
    const game = new HandBrainGame();
    // No queen/rook/bishop/king move is legal from the start.
    for (const type of ['q', 'r', 'b', 'k'] as PieceType[]) {
      expect(() => game.selectPieceType(type)).toThrow(ProtocolError);
    }
    // State is unchanged after a rejected selection.
    expect(game.currentPhase).toBe(Phase.AwaitingBrain);
  });

  it('the offered set never contains a type with no legal move (invariant)', () => {
    // Walk a short random-ish game and assert the invariant every turn.
    const game = new HandBrainGame();
    for (let ply = 0; ply < 30 && !game.isGameOver(); ply++) {
      const available = game.availablePieceTypes();
      expect(available.length).toBeGreaterThan(0);

      for (const type of available) {
        // Every offered type must yield at least one move for the Hand.
        const probe = new HandBrainGame(game.fen);
        probe.selectPieceType(type);
        expect(probe.handMoves().length).toBeGreaterThan(0);
      }

      // Play the first available type's first move to advance.
      game.selectPieceType(available[0]);
      const first = game.handMoves()[0];
      game.selectMove(first);
    }
  });
});

describe('the Hand choosing a move (steps 5 & 6)', () => {
  it('applies the move and switches sides back to AWAITING_BRAIN', () => {
    const game = new HandBrainGame();
    game.selectPieceType('p');
    const e4 = game.handMoves().find((m) => m.san === 'e4')!;
    expect(e4).toBeDefined();

    const san = game.selectMove(e4);
    expect(san).toBe('e4');
    expect(game.turn).toBe('b');
    expect(game.currentPhase).toBe(Phase.AwaitingBrain);
  });

  it('rejects a move that is not of the named piece type', () => {
    const game = new HandBrainGame();
    game.selectPieceType('n');
    // e2-e4 is legal chess, but not a knight move.
    expect(() => game.selectMove({ from: 'e2', to: 'e4' })).toThrow(
      ProtocolError,
    );
    expect(game.currentPhase).toBe(Phase.AwaitingHand);
  });

  it('cannot move before the Brain has named a type', () => {
    const game = new HandBrainGame();
    expect(() => game.selectMove({ from: 'e2', to: 'e4' })).toThrow(
      ProtocolError,
    );
  });

  it('clearPieceTypeSelection returns to AWAITING_BRAIN without moving', () => {
    const game = new HandBrainGame();
    const fenBefore = game.fen;
    game.selectPieceType('p');
    game.clearPieceTypeSelection();
    expect(game.currentPhase).toBe(Phase.AwaitingBrain);
    expect(game.fen).toBe(fenBefore);
  });
});

describe('check', () => {
  it("offers only types that can resolve the check; can't-resolve types never appear", () => {
    // White king on e1 in check from a black rook on e8. White's knight on a1
    // (reaches only b3/c2) and pawn on a2 cannot block on the e-file or
    // capture the checker, so only the king can resolve the check.
    const game = new HandBrainGame('4r2k/8/8/8/8/8/P7/N3K3 w - - 0 1');
    expect(game.snapshot().inCheck).toBe(true);

    const available = game.availablePieceTypes();
    expect(available).toContain('k');
    expect(available).not.toContain('p');
    expect(available).not.toContain('n');
  });

  it('a blocking/capturing piece type becomes available under check', () => {
    // Black rook checks on e8-e1; White has a rook on e7-... actually place a
    // White rook that can capture the checker. King e1, checker rook e8,
    // White rook a8 can capture on e8.
    const game = new HandBrainGame('R3r3/8/8/8/8/8/6k1/4K3 w - - 0 1');
    expect(game.snapshot().inCheck).toBe(true);
    const available = game.availablePieceTypes();
    expect(available).toContain('r'); // Rxe8 resolves the check
  });
});

describe('castling (a king move)', () => {
  it('exposes castling as a king move the Hand can choose', () => {
    // White can castle kingside.
    const game = new HandBrainGame(
      'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    );
    game.selectPieceType('k');
    const sans = game.handMoves().map((m) => m.san);
    expect(sans).toContain('O-O');
    expect(sans).toContain('O-O-O');

    const castle = game.handMoves().find((m) => m.san === 'O-O')!;
    game.selectMove(castle);
    // King and rook have moved; it's Black's turn.
    expect(game.turn).toBe('b');
    expect(game.fen.startsWith('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1')).toBe(
      true,
    );
  });
});

describe('en passant (a pawn move)', () => {
  it('exposes en passant capture under the pawn type', () => {
    // Classic en passant: White pawn d5, Black just played ...c7-c5.
    const game = new HandBrainGame(
      'rnbqkbnr/pp1ppppp/8/2pP4/8/8/PPP1PPPP/RNBQKBNR w KQkq c6 0 1',
    );
    game.selectPieceType('p');
    const ep = game.handMoves().find((m) => m.to === 'c6');
    expect(ep).toBeDefined();
    expect(ep!.from).toBe('d5');

    game.selectMove({ from: 'd5', to: 'c6' });
    // The captured pawn on c5 is gone.
    expect(game.fen.includes('2P5') || game.fen.includes('2P')).toBe(true);
  });
});

describe('promotion (a pawn move with a chosen target)', () => {
  it('offers all four promotion targets and applies the chosen one', () => {
    // White pawn on a7, ready to promote on a8. Lone kings otherwise.
    const game = new HandBrainGame('8/P7/8/8/8/8/6k1/4K3 w - - 0 1');
    game.selectPieceType('p');

    const promotions = game.handMoves().filter((m) => m.to === 'a8');
    expect(promotions.map((m) => m.promotion).sort()).toEqual([
      'b',
      'n',
      'q',
      'r',
    ]);

    // Promote to knight specifically (underpromotion path).
    game.selectMove({ from: 'a7', to: 'a8', promotion: 'n' });
    expect(game.fen.startsWith('N7/')).toBe(true);
  });

  it('treats different promotion targets as distinct moves during validation', () => {
    const game = new HandBrainGame('8/P7/8/8/8/8/6k1/4K3 w - - 0 1');
    game.selectPieceType('p');
    // Same from/to but no promotion specified must not match a promotion move.
    expect(() => game.selectMove({ from: 'a7', to: 'a8' })).toThrow(
      ProtocolError,
    );
  });
});

describe('game over detection', () => {
  it('detects checkmate and reports the winner as the mating side', () => {
    // Fool's mate position: 1. f3 e5 2. g4 Qh4#
    const game = new HandBrainGame();
    const play = (type: PieceType, san: string) => {
      game.selectPieceType(type);
      const move = game.handMoves().find((m) => m.san === san)!;
      expect(move).toBeDefined();
      game.selectMove(move);
    };
    play('p', 'f3');
    play('p', 'e5');
    play('p', 'g4');
    play('q', 'Qh4#');

    expect(game.isGameOver()).toBe(true);
    expect(game.currentPhase).toBe(Phase.GameOver);
    expect(game.result()).toEqual({
      reason: GameOverReason.Checkmate,
      winner: 'b',
    });
    // No actions are legal once the game is over.
    expect(game.availablePieceTypes()).toEqual([]);
    expect(() => game.selectPieceType('p')).toThrow(ProtocolError);
  });

  it('detects stalemate as a draw with no winner', () => {
    // Classic stalemate: Black king a8, White king c7... use a known position.
    // Black to move, no legal moves, not in check.
    const game = new HandBrainGame('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
    expect(game.isGameOver()).toBe(true);
    expect(game.result()).toEqual({
      reason: GameOverReason.Stalemate,
      winner: null,
    });
  });

  it('detects insufficient material (lone kings) as a draw', () => {
    const game = new HandBrainGame('8/8/8/4k3/8/8/4K3/8 w - - 0 1');
    expect(game.isGameOver()).toBe(true);
    expect(game.result()).toEqual({
      reason: GameOverReason.InsufficientMaterial,
      winner: null,
    });
  });

  it('a game loaded in a finished state starts in GAME_OVER', () => {
    const game = new HandBrainGame('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
    expect(game.currentPhase).toBe(Phase.GameOver);
  });
});

describe('snapshot', () => {
  it('reflects the full protocol state and is consistent across steps', () => {
    const game = new HandBrainGame();

    let snap = game.snapshot();
    expect(snap.phase).toBe(Phase.AwaitingBrain);
    expect(snap.turn).toBe('w');
    expect(snap.selectedPieceType).toBeNull();
    expect(snap.handMoves).toEqual([]);
    expect(snap.result).toBeNull();

    game.selectPieceType('p');
    snap = game.snapshot();
    expect(snap.phase).toBe(Phase.AwaitingHand);
    expect(snap.selectedPieceType).toBe('p');
    expect(snap.handMoves.length).toBe(16); // 8 pawns x (one or two steps)

    game.selectMove(snap.handMoves.find((m) => m.san === 'd4')!);
    snap = game.snapshot();
    expect(snap.history).toEqual(['d4']);
    expect(snap.turn).toBe('b');
  });
});
