import type { Color } from '@hnb/core';

/**
 * Locate a king's square from a FEN string, used purely for the UI's
 * "king in check" highlight. chess.js remains authoritative for *whether*
 * there is a check; this only finds where to draw the marker.
 */
export function findKingSquare(fen: string, color: Color): string | null {
  const board = fen.split(' ')[0];
  const ranks = board.split('/'); // index 0 = rank 8, index 7 = rank 1
  const kingChar = color === 'w' ? 'K' : 'k';

  for (let r = 0; r < ranks.length; r++) {
    let file = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        if (ch === kingChar) {
          const fileLetter = String.fromCharCode('a'.charCodeAt(0) + file);
          const rankNumber = 8 - r;
          return `${fileLetter}${rankNumber}`;
        }
        file += 1;
      }
    }
  }
  return null;
}
