import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import type { GameSnapshot, LegalMove } from '@hnb/core';
import { findKingSquare } from './fen';
import { StatusBanner } from './StatusBanner';
import { HandPanel } from './HandPanel';
import { PromotionPicker } from './PromotionPicker';

/** Matches react-chessboard's per-square style value type. */
type SquareStyle = Record<string, string | number>;

interface PendingPromotion {
  from: string;
  to: string;
  options: NonNullable<LegalMove['promotion']>[];
}

/**
 * The shared play surface: status banner, board with Hand move selection
 * (click or drag, with promotion picker), and the side column. Local and
 * online games render through this same component; they differ only in how
 * actions are gated and where they are sent, which the parent controls via
 * props.
 */
export function PlaySurface({
  snapshot,
  orientation,
  handEnabled,
  onSelectMove,
  onBackToBrain,
  statusTag,
  topPanels,
  bottomPanels,
}: {
  snapshot: GameSnapshot;
  orientation: 'white' | 'black';
  /** True when the local user may act as the Hand right now. */
  handEnabled: boolean;
  onSelectMove: (move: {
    from: string;
    to: string;
    promotion?: LegalMove['promotion'];
  }) => void;
  /** Lets the Hand send it back to the Brain (local human Brain only). */
  onBackToBrain?: () => void;
  /** Extra status context, e.g. "(AI)" or "(you)". */
  statusTag?: string;
  /** Rendered at the top of the side column (Brain panel, indicators, …). */
  topPanels?: ReactNode;
  /** Rendered at the bottom of the side column (history, links, …). */
  bottomPanels?: ReactNode;
}) {
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
   * immediately submitted.
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

    onSelectMove({ from, to });
    setSelectedFrom(null);
    return true;
  }

  function handleSquareClick(square: string) {
    if (!handEnabled || pendingPromotion) return;

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
    if (!handEnabled) return false;
    return attemptMove(from, to);
  }

  function handlePickMove(move: LegalMove) {
    // List items are specific moves (including a chosen promotion), so apply
    // directly without going through the promotion picker.
    onSelectMove({ from: move.from, to: move.to, promotion: move.promotion });
    setSelectedFrom(null);
  }

  function handleChoosePromotion(target: NonNullable<LegalMove['promotion']>) {
    if (!pendingPromotion) return;
    onSelectMove({
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
        lastMove: snapshot.lastMove,
        showHandHints: handEnabled,
        sourceSquares,
        selectedFrom,
        targetsForSelected,
      }),
    [
      snapshot.fen,
      snapshot.inCheck,
      snapshot.turn,
      snapshot.lastMove,
      handEnabled,
      sourceSquares,
      selectedFrom,
      targetsForSelected,
    ],
  );

  const [boardRef, boardWidth] = useElementWidth<HTMLDivElement>(480);

  return (
    <>
      <StatusBanner snapshot={snapshot} tag={statusTag} />

      <div className="layout">
        <div className="board-column" ref={boardRef}>
          <Chessboard
            position={snapshot.fen}
            boardWidth={boardWidth}
            boardOrientation={orientation}
            arePiecesDraggable={handEnabled}
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
          {topPanels}

          {handEnabled && snapshot.selectedPieceType && (
            <HandPanel
              pieceType={snapshot.selectedPieceType}
              moves={snapshot.handMoves}
              selectedFrom={selectedFrom}
              onPickMove={handlePickMove}
              onBack={onBackToBrain}
            />
          )}

          {bottomPanels}
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
  lastMove: { from: string; to: string } | null;
  showHandHints: boolean;
  sourceSquares: Set<string>;
  selectedFrom: string | null;
  targetsForSelected: Set<string>;
}): Record<string, SquareStyle> {
  const styles: Record<string, SquareStyle> = {};

  // Persistent highlight of the move just played (under all other markers).
  if (args.lastMove) {
    for (const sq of [args.lastMove.from, args.lastMove.to]) {
      styles[sq] = { background: 'rgba(255, 213, 79, 0.32)' };
    }
  }

  if (args.showHandHints) {
    // Mark every movable piece of the named type (keep any last-move tint).
    for (const sq of args.sourceSquares) {
      styles[sq] = {
        ...styles[sq],
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
