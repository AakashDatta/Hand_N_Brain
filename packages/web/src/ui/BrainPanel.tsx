import { PIECE_TYPE_NAMES, type PieceType } from '@hnb/core';

const PIECE_GLYPHS: Record<PieceType, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

/**
 * The Brain's control: buttons for each piece type that has at least one legal
 * move this turn. Only these types are offered — a type with no legal move can
 * never be named (the engine derives this set from the legal-move list).
 */
export function BrainPanel({
  available,
  onSelect,
}: {
  available: PieceType[];
  onSelect: (type: PieceType) => void;
}) {
  return (
    <div className="panel">
      <h2 className="panel__title">Brain</h2>
      <p className="panel__hint">
        Name a piece type. The Hand will choose which one to move and where.
      </p>
      <div className="piece-grid">
        {available.map((type) => (
          <button
            key={type}
            type="button"
            className="piece-button"
            onClick={() => onSelect(type)}
          >
            <span className="piece-button__glyph" aria-hidden="true">
              {PIECE_GLYPHS[type]}
            </span>
            <span className="piece-button__label">{PIECE_TYPE_NAMES[type]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
