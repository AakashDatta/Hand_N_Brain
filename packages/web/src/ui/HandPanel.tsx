import { PIECE_TYPE_NAMES, type LegalMove, type PieceType } from '@hnb/core';

/**
 * The Hand's control: shows the piece type the Brain named and lists the legal
 * moves of that type. The Hand can pick a move here or directly on the board.
 * A "Back" affordance lets the Hand reconsider before committing (local
 * convenience only — no move has been made, so nothing is revealed). It is
 * absent when the Brain seat is an AI: the Hand cannot ask the Brain to
 * re-decide.
 */
export function HandPanel({
  pieceType,
  moves,
  selectedFrom,
  onPickMove,
  onBack,
}: {
  pieceType: PieceType;
  moves: LegalMove[];
  selectedFrom: string | null;
  onPickMove: (move: LegalMove) => void;
  onBack?: () => void;
}) {
  return (
    <div className="panel">
      <div className="panel__header">
        <h2 className="panel__title">Hand</h2>
        {onBack && (
          <button type="button" className="link-button" onClick={onBack}>
            ← Back to Brain
          </button>
        )}
      </div>
      <p className="panel__hint">
        Brain chose <strong>{PIECE_TYPE_NAMES[pieceType]}</strong>. Move one on
        the board, or pick from the list.
      </p>
      <ul className="move-list">
        {moves.map((move) => {
          const isActiveSource =
            selectedFrom !== null && move.from === selectedFrom;
          return (
            <li key={move.san}>
              <button
                type="button"
                className={`move-button${isActiveSource ? ' move-button--active' : ''}`}
                onClick={() => onPickMove(move)}
              >
                {move.san}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
