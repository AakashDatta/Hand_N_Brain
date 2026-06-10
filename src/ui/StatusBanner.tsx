import {
  GameOverReason,
  PIECE_TYPE_NAMES,
  Phase,
  Role,
  type Color,
  type GameSnapshot,
} from '../engine';

const COLOR_NAMES: Record<Color, string> = { w: 'White', b: 'Black' };

const GAME_OVER_TEXT: Record<GameOverReason, string> = {
  [GameOverReason.Checkmate]: 'Checkmate',
  [GameOverReason.Stalemate]: 'Stalemate — draw',
  [GameOverReason.ThreefoldRepetition]: 'Draw by threefold repetition',
  [GameOverReason.InsufficientMaterial]: 'Draw — insufficient material',
  [GameOverReason.FiftyMoveRule]: 'Draw — fifty-move rule',
  [GameOverReason.Draw]: 'Draw',
};

/**
 * Shows whose turn it is, which role must act, and any check/game-over state.
 */
export function StatusBanner({ snapshot }: { snapshot: GameSnapshot }) {
  if (snapshot.phase === Phase.GameOver && snapshot.result) {
    const { reason, winner } = snapshot.result;
    const headline =
      reason === GameOverReason.Checkmate && winner
        ? `${COLOR_NAMES[winner]} wins by checkmate`
        : GAME_OVER_TEXT[reason];
    return (
      <div className="banner banner--over">
        <span className="banner__title">Game over</span>
        <span className="banner__detail">{headline}</span>
      </div>
    );
  }

  const side = COLOR_NAMES[snapshot.turn];
  const role =
    snapshot.phase === Phase.AwaitingBrain ? Role.Brain : Role.Hand;
  const roleLabel = role === Role.Brain ? 'Brain' : 'Hand';
  const action =
    role === Role.Brain
      ? 'name a piece type'
      : `move a ${PIECE_TYPE_NAMES[
          snapshot.selectedPieceType!
        ].toLowerCase()}`;

  return (
    <div className={`banner banner--${snapshot.turn === 'w' ? 'white' : 'black'}`}>
      <span className="banner__title">
        {side} · {roleLabel} to {action}
      </span>
      {snapshot.inCheck && <span className="banner__check">Check!</span>}
    </div>
  );
}
