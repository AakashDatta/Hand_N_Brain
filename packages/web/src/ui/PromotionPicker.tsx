import { PIECE_TYPE_NAMES, type Color, type LegalMove } from '../engine';

type PromotionTarget = NonNullable<LegalMove['promotion']>;

const PROMOTION_GLYPHS: Record<Color, Record<PromotionTarget, string>> = {
  w: { q: '♕', r: '♖', b: '♗', n: '♘' },
  b: { q: '♛', r: '♜', b: '♝', n: '♞' },
};

const PROMOTION_ORDER: PromotionTarget[] = ['q', 'r', 'b', 'n'];

/**
 * Modal shown when the Hand's pawn move reaches the back rank: the Hand also
 * chooses the promotion target. Only the targets actually available for this
 * move are offered.
 */
export function PromotionPicker({
  color,
  options,
  onChoose,
  onCancel,
}: {
  color: Color;
  options: PromotionTarget[];
  onChoose: (target: PromotionTarget) => void;
  onCancel: () => void;
}) {
  const ordered = PROMOTION_ORDER.filter((t) => options.includes(t));
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-label="Choose promotion piece"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal__title">Promote to…</h3>
        <div className="piece-grid">
          {ordered.map((target) => (
            <button
              key={target}
              type="button"
              className="piece-button"
              onClick={() => onChoose(target)}
            >
              <span className="piece-button__glyph" aria-hidden="true">
                {PROMOTION_GLYPHS[color][target]}
              </span>
              <span className="piece-button__label">
                {PIECE_TYPE_NAMES[target]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
