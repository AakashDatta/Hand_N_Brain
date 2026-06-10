import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { pieceTypeAtSquare } from './position';

describe('pieceTypeAtSquare', () => {
  const startFen = new Chess().fen();

  it('reads piece types from the start position', () => {
    expect(pieceTypeAtSquare(startFen, 'e2')).toBe('p');
    expect(pieceTypeAtSquare(startFen, 'g1')).toBe('n');
    expect(pieceTypeAtSquare(startFen, 'e1')).toBe('k');
    expect(pieceTypeAtSquare(startFen, 'd8')).toBe('q');
  });

  it('returns null for an empty square', () => {
    expect(pieceTypeAtSquare(startFen, 'e4')).toBeNull();
  });
});
