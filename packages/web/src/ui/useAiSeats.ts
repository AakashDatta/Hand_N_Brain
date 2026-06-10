import { useEffect, useRef, useState } from 'react';
import { Role, type LegalMove } from '@hnb/core';
import { StockfishEngine } from '../ai/StockfishEngine';
import { legalMoveToUci, moveToUci } from '../ai/uci';
import { pieceTypeAtSquare } from '../ai/position';
import { actorFor, hasAiSeat, type Actor, type GameConfig } from '../game/seats';
import type { HandBrainController } from './useHandBrainGame';

/**
 * Drives every AI-controlled seat: whenever the protocol is waiting on a seat
 * configured as 'ai', run the appropriate Stockfish search and apply the
 * result through the same validated controller methods a human would use.
 *
 *  - AI Brain: search the full position, then announce only the piece *type*
 *    of the best move — the one bit of information a Brain may communicate.
 *  - AI Hand: search restricted (UCI `searchmoves`) to the legal moves of the
 *    type the Brain named, then play the engine's choice.
 *
 * Returns the actor the engine is currently thinking for, or null.
 */
export function useAiSeats(
  game: HandBrainController,
  config: GameConfig,
): Actor | null {
  const [thinking, setThinking] = useState<Actor | null>(null);
  const engineRef = useRef<StockfishEngine | null>(null);

  // Monotonic token: bumped whenever the position or config changes, so a
  // search result that arrives late (after a reset/new game) is discarded
  // instead of being applied to the wrong position. Also deduplicates
  // dispatches under React StrictMode's double-run of effects.
  const epochRef = useRef(0);
  const dispatchedKeyRef = useRef<string | null>(null);

  const { snapshot } = game;

  useEffect(() => {
    if (!hasAiSeat(config)) return;

    const actor = actorFor(snapshot, config);
    if (!actor || actor.controller !== 'ai') {
      setThinking(null);
      return;
    }

    // One dispatch per distinct protocol state.
    const stateKey = `${snapshot.fen}|${snapshot.phase}`;
    if (dispatchedKeyRef.current === stateKey) return;
    dispatchedKeyRef.current = stateKey;

    const epoch = ++epochRef.current;
    const engine = (engineRef.current ??= new StockfishEngine());
    setThinking(actor);

    const act = async () => {
      if (actor.role === Role.Brain) {
        // Full search; announce the moved piece's type only.
        const best = await engine.bestMove({
          fen: snapshot.fen,
          difficulty: config.difficulty,
        });
        if (epoch !== epochRef.current) return;
        const pieceType = pieceTypeAtSquare(snapshot.fen, best.from);
        if (!pieceType) {
          throw new Error(`Engine moved from empty square ${best.from}`);
        }
        game.selectPieceType(pieceType);
      } else {
        // Restricted search over the Brain-approved moves.
        const allowed = snapshot.handMoves;
        const best = await engine.bestMove({
          fen: snapshot.fen,
          difficulty: config.difficulty,
          searchMoves: allowed.map(legalMoveToUci),
        });
        if (epoch !== epochRef.current) return;
        game.selectMove(matchEngineMove(best, allowed));
      }
    };

    act()
      .catch((error) => {
        console.error('AI seat failed to act:', error);
      })
      .finally(() => {
        if (epoch === epochRef.current) setThinking(null);
      });
  }, [snapshot, config, game]);

  // Invalidate in-flight searches and release the worker when the
  // configuration changes or the app unmounts.
  useEffect(() => {
    return () => {
      epochRef.current++;
      dispatchedKeyRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [config]);

  return thinking;
}

/**
 * Map the engine's UCI best move back to the exact LegalMove in the filtered
 * set. The engine was restricted with `searchmoves`, so a miss indicates an
 * engine/protocol bug; fall back to the first legal move to keep the game
 * playable rather than freezing it.
 */
function matchEngineMove(
  engineMove: { from: string; to: string; promotion?: LegalMove['promotion'] },
  allowed: LegalMove[],
): LegalMove {
  const match = allowed.find(
    (m) =>
      m.from === engineMove.from &&
      m.to === engineMove.to &&
      m.promotion === engineMove.promotion,
  );
  if (match) return match;

  console.error(
    `Engine returned ${moveToUci(engineMove)} outside the allowed set; ` +
      'falling back to the first legal move.',
  );
  return allowed[0];
}
