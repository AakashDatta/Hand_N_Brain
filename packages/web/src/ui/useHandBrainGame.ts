import { useCallback, useMemo, useState } from 'react';
import {
  HandBrainGame,
  type GameSnapshot,
  type LegalMove,
  type PieceType,
} from '../engine';

/**
 * React binding for {@link HandBrainGame}.
 *
 * The engine is mutable and authoritative; React only needs to re-render when
 * it changes. We keep the engine instance in state and bump a snapshot after
 * every mutation, so components render purely from the immutable snapshot.
 */
export interface HandBrainController {
  snapshot: GameSnapshot;
  selectPieceType: (type: PieceType) => void;
  clearPieceType: () => void;
  selectMove: (move: {
    from: string;
    to: string;
    promotion?: LegalMove['promotion'];
  }) => void;
  newGame: () => void;
}

export function useHandBrainGame(initialFen?: string): HandBrainController {
  const [game, setGame] = useState(() => new HandBrainGame(initialFen));
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => game.snapshot());

  // Run a mutation against the engine, then publish a fresh snapshot.
  const commit = useCallback(
    (mutate: (g: HandBrainGame) => void) => {
      mutate(game);
      setSnapshot(game.snapshot());
    },
    [game],
  );

  const selectPieceType = useCallback(
    (type: PieceType) => commit((g) => g.selectPieceType(type)),
    [commit],
  );

  const clearPieceType = useCallback(
    () => commit((g) => g.clearPieceTypeSelection()),
    [commit],
  );

  const selectMove = useCallback(
    (move: { from: string; to: string; promotion?: LegalMove['promotion'] }) =>
      commit((g) => g.selectMove(move)),
    [commit],
  );

  const newGame = useCallback(() => {
    const fresh = new HandBrainGame(initialFen);
    setGame(fresh);
    setSnapshot(fresh.snapshot());
  }, [initialFen]);

  return useMemo(
    () => ({ snapshot, selectPieceType, clearPieceType, selectMove, newGame }),
    [snapshot, selectPieceType, clearPieceType, selectMove, newGame],
  );
}
