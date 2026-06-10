import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Phase, Role, type LegalMove } from '../engine';
import {
  actorFor,
  humanPerspective,
  type GameConfig,
} from '../game/seats';
import { useHandBrainGame } from './useHandBrainGame';
import { useAiSeats } from './useAiSeats';
import { findKingSquare } from './fen';
import { StatusBanner } from './StatusBanner';
import { BrainPanel } from './BrainPanel';
import { HandPanel } from './HandPanel';
import { MoveHistory } from './MoveHistory';
import { PromotionPicker } from './PromotionPicker';
import { GameSetup } from './GameSetup';

/** Matches react-chessboard's per-square style value type. */
type SquareStyle = Record<string, string | number>;

/**
 * Top-level screen flow: configure a game, play it, return to setup.
 * The GameView is remounted (via key) for every new game so that engine,
 * AI orchestration, and board state always start fresh.
 */
export function App() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [gameId, setGameId] = useState(0);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Hand &amp; Brain Chess</h1>
        <p className="app__subtitle">
          The Brain names a piece type; the Hand moves a piece of that type.
        </p>
      </header>

      {config === null ? (
        <GameSetup
          onStart={(next) => {
            setConfig(next);
            setGameId((id) => id + 1);
          }}
        />
      ) : (
        <GameView
          key={gameId}
          config={config}
          onExit={() => setConfig(null)}
        />
      )}
    </div>
  );
}

interface PendingPromotion {
  from: string;
  to: string;
  options: NonNullable<LegalMove['promotion']>[];
}

function GameView({
  config,
  onExit,
}: {
  config: GameConfig;
  onExit: () => void;
}) {
  const game = useHandBrainGame();
  const { snapshot } = game;
  const thinking = useAiSeats(game, config);

  const actor = actorFor(snapshot, config);
  const humanIsHand =
    actor !== null && actor.role === Role.Hand && actor.controller === 'human';
  const brainSeatIsHuman =
    actor !== null && config.seats[actor.color].brain === 'human';

  // The Hand's in-progress board selection (chosen source square), and any
  // pending promotion awaiting the Hand's choice of target piece.
  const [selectedFrom, setSelectedFrom] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null);

  // Reset transient board selection whenever the protocol phase changes.
  useEffect(() => {
    setSelectedFrom(null);
    setPendingPromotion(null);
  }, [snapshot.phase, snapshot.turn]);

  const sourceSquares = useMemo(
    () => new Set(snapshot.handMoves.map((m) => m.from)),
    [snapshot.handMoves],
  );

  const targetsForSelected = useMemo(() => {
    if (!selectedFrom) return new Set<string>();
    return new Set(
      snapshot.handMoves
        .filter((m) => m.from === selectedFrom)
        .map((m) => m.to),
    );
  }, [snapshot.handMoves, selectedFrom]);

  /**
   * Attempt to play the Hand's move from->to. If the move requires choosing a
   * promotion piece, open the picker instead. Returns whether a move was
   * immediately applied.
   */
  function attemptMove(from: string, to: string): boolean {
    const matches = snapshot.handMoves.filter(
      (m) => m.from === from && m.to === to,
    );
    if (matches.length === 0) return false;

    const promotions = matches
      .map((m) => m.promotion)
      .filter((p): p is NonNullable<LegalMove['promotion']> => p !== undefined);

    if (promotions.length > 0) {
      setPendingPromotion({ from, to, options: promotions });
      setSelectedFrom(null);
      return false;
    }

    game.selectMove({ from, to });
    setSelectedFrom(null);
    return true;
  }

  function handleSquareClick(square: string) {
    if (!humanIsHand || pendingPromotion) return;

    // Clicking a legal target of the currently selected piece plays the move.
    if (selectedFrom && targetsForSelected.has(square)) {
      attemptMove(selectedFrom, square);
      return;
    }
    // Otherwise (re)select a movable piece, or clear the selection.
    if (sourceSquares.has(square)) {
      setSelectedFrom(square);
    } else {
      setSelectedFrom(null);
    }
  }

  function handlePieceDrop(from: string, to: string): boolean {
    if (!humanIsHand) return false;
    return attemptMove(from, to);
  }

  function handlePickMove(move: LegalMove) {
    // List items are specific moves (including a chosen promotion), so apply
    // directly without going through the promotion picker.
    game.selectMove({ from: move.from, to: move.to, promotion: move.promotion });
    setSelectedFrom(null);
  }

  function handleChoosePromotion(target: NonNullable<LegalMove['promotion']>) {
    if (!pendingPromotion) return;
    game.selectMove({
      from: pendingPromotion.from,
      to: pendingPromotion.to,
      promotion: target,
    });
    setPendingPromotion(null);
  }

  const squareStyles = useMemo(
    () =>
      computeSquareStyles({
        fen: snapshot.fen,
        inCheck: snapshot.inCheck,
        turn: snapshot.turn,
        showHandHints: humanIsHand,
        sourceSquares,
        selectedFrom,
        targetsForSelected,
      }),
    [
      snapshot.fen,
      snapshot.inCheck,
      snapshot.turn,
      humanIsHand,
      sourceSquares,
      selectedFrom,
      targetsForSelected,
    ],
  );

  const [boardRef, boardWidth] = useElementWidth<HTMLDivElement>(480);

  // With AI in the game the board stays oriented toward the human team;
  // in all-human hot-seat it follows the side to move.
  const perspective = humanPerspective(config);
  const orientation = (perspective ?? snapshot.turn) === 'w' ? 'white' : 'black';

  return (
    <>
      <StatusBanner snapshot={snapshot} actor={actor} />

      <div className="layout">
        <div className="board-column" ref={boardRef}>
          <Chessboard
            position={snapshot.fen}
            boardWidth={boardWidth}
            boardOrientation={orientation}
            arePiecesDraggable={humanIsHand}
            onSquareClick={(square) => handleSquareClick(square)}
            onPieceDrop={(from, to) => handlePieceDrop(from, to)}
            customSquareStyles={squareStyles}
            customBoardStyle={{
              borderRadius: '6px',
              boxShadow: '0 4px 18px rgba(0,0,0,0.25)',
            }}
          />
        </div>

        <aside className="side-column">
          {thinking !== null && (
            <div className="panel panel--thinking">
              <h2 className="panel__title">
                {thinking.role === Role.Brain ? 'AI Brain' : 'AI Hand'}
              </h2>
              <p className="panel__hint">Stockfish is thinking…</p>
            </div>
          )}

          {actor?.role === Role.Brain && actor.controller === 'human' && (
            <BrainPanel
              available={snapshot.availablePieceTypes}
              onSelect={game.selectPieceType}
            />
          )}

          {humanIsHand && snapshot.selectedPieceType && (
            <HandPanel
              pieceType={snapshot.selectedPieceType}
              moves={snapshot.handMoves}
              selectedFrom={selectedFrom}
              onPickMove={handlePickMove}
              onBack={brainSeatIsHuman ? game.clearPieceType : undefined}
            />
          )}

          {snapshot.phase === Phase.GameOver && (
            <div className="panel">
              <h2 className="panel__title">Game over</h2>
              <div className="panel__actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={game.newGame}
                >
                  Rematch
                </button>
                <button type="button" className="link-button" onClick={onExit}>
                  Change mode
                </button>
              </div>
            </div>
          )}

          <MoveHistory history={snapshot.history} />

          {snapshot.phase !== Phase.GameOver && (
            <button
              type="button"
              className="link-button reset-link"
              onClick={onExit}
            >
              ← New game / change mode
            </button>
          )}
        </aside>
      </div>

      {pendingPromotion && (
        <PromotionPicker
          color={snapshot.turn}
          options={pendingPromotion.options}
          onChoose={handleChoosePromotion}
          onCancel={() => setPendingPromotion(null)}
        />
      )}
    </>
  );
}

/** Build the per-square highlight styles for the current state. */
function computeSquareStyles(args: {
  fen: string;
  inCheck: boolean;
  turn: 'w' | 'b';
  showHandHints: boolean;
  sourceSquares: Set<string>;
  selectedFrom: string | null;
  targetsForSelected: Set<string>;
}): Record<string, SquareStyle> {
  const styles: Record<string, SquareStyle> = {};

  if (args.showHandHints) {
    // Mark every movable piece of the named type.
    for (const sq of args.sourceSquares) {
      styles[sq] = {
        boxShadow: 'inset 0 0 0 3px rgba(56, 132, 255, 0.65)',
      };
    }
    // Mark legal destinations of the selected piece.
    for (const sq of args.targetsForSelected) {
      styles[sq] = {
        ...styles[sq],
        background:
          'radial-gradient(circle, rgba(46, 160, 67, 0.85) 22%, transparent 26%)',
      };
    }
    // Highlight the selected source square last so it wins.
    if (args.selectedFrom) {
      styles[args.selectedFrom] = {
        background: 'rgba(255, 213, 79, 0.6)',
      };
    }
  }

  // King-in-check marker, drawn on top of everything else.
  if (args.inCheck) {
    const kingSquare = findKingSquare(args.fen, args.turn);
    if (kingSquare) {
      styles[kingSquare] = {
        ...styles[kingSquare],
        background: 'rgba(214, 48, 49, 0.55)',
      };
    }
  }

  return styles;
}

/**
 * Track the rendered width of an element so the board can size responsively.
 * react-chessboard needs an explicit pixel width, so we measure the container.
 */
function useElementWidth<T extends HTMLElement>(
  fallback: number,
): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = Math.min(element.clientWidth, 560);
      if (next > 0) setWidth(next);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
