import { useState } from 'react';
import { normalizeRoomCode } from '@hnb/core';
import { Phase, Role } from '@hnb/core';
import { actorFor, humanPerspective, type GameConfig } from '../game/seats';
import { useHandBrainGame } from './useHandBrainGame';
import { useAiSeats } from './useAiSeats';
import { PlaySurface } from './PlaySurface';
import { BrainPanel } from './BrainPanel';
import { MoveHistory } from './MoveHistory';
import { GameSetup } from './GameSetup';
import { OnlineView } from '../online/OnlineView';

type Screen =
  | { kind: 'setup' }
  | { kind: 'local'; config: GameConfig; gameId: number }
  | { kind: 'online' };

/**
 * Top-level screen flow: configure a game, then play it locally (hot-seat or
 * with AI seats) or online. Local games are remounted (via key) for every new
 * game so engine and AI state always start fresh.
 */
/** A ?room=CODE invite link drops the visitor straight into online play. */
function inviteCodeFromUrl(): string | null {
  const code = normalizeRoomCode(
    new URLSearchParams(window.location.search).get('room'),
  );
  if (code) {
    // Strip the param so leaving the room doesn't re-trigger the invite.
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', url);
  }
  return code;
}

export function App() {
  const [inviteCode] = useState(inviteCodeFromUrl);
  const [screen, setScreen] = useState<Screen>(
    inviteCode ? { kind: 'online' } : { kind: 'setup' },
  );

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Hand &amp; Brain Chess</h1>
        <p className="app__subtitle">
          The Brain names a piece type; the Hand moves a piece of that type.
        </p>
      </header>

      {screen.kind === 'setup' && (
        <GameSetup
          onStart={(config) =>
            setScreen({ kind: 'local', config, gameId: Date.now() })
          }
          onPlayOnline={() => setScreen({ kind: 'online' })}
        />
      )}
      {screen.kind === 'local' && (
        <LocalGameView
          key={screen.gameId}
          config={screen.config}
          onRematch={() => setScreen({ ...screen, gameId: screen.gameId + 1 })}
          onExit={() => setScreen({ kind: 'setup' })}
        />
      )}
      {screen.kind === 'online' && (
        <OnlineView
          autoJoinCode={inviteCode}
          onExit={() => setScreen({ kind: 'setup' })}
        />
      )}
    </div>
  );
}

function LocalGameView({
  config,
  onRematch,
  onExit,
}: {
  config: GameConfig;
  onRematch: () => void;
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

  // With AI in the game the board stays oriented toward the human team;
  // in all-human hot-seat it follows the side to move.
  const perspective = humanPerspective(config);
  const orientation = (perspective ?? snapshot.turn) === 'w' ? 'white' : 'black';

  return (
    <PlaySurface
      snapshot={snapshot}
      orientation={orientation}
      handEnabled={humanIsHand}
      onSelectMove={game.selectMove}
      onBackToBrain={
        humanIsHand && brainSeatIsHuman ? game.clearPieceType : undefined
      }
      statusTag={actor?.controller === 'ai' ? '(AI)' : undefined}
      topPanels={
        <>
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

          {snapshot.phase === Phase.GameOver && (
            <div className="panel">
              <h2 className="panel__title">Game over</h2>
              <div className="panel__actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={onRematch}
                >
                  Rematch
                </button>
                <button type="button" className="link-button" onClick={onExit}>
                  Change mode
                </button>
              </div>
            </div>
          )}
        </>
      }
      bottomPanels={
        <>
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
        </>
      }
    />
  );
}
