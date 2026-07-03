import { useEffect, useState } from 'react';
import {
  Phase,
  Role,
  type LeaderboardEntry,
  type MatchHistoryEntry,
  type MatchPlayerInfo,
  type QueueRole,
} from '@hnb/core';
import { useOnlineGame } from './useOnlineGame';
import { PlaySurface } from '../ui/PlaySurface';
import { BrainPanel } from '../ui/BrainPanel';
import { MoveHistory } from '../ui/MoveHistory';

/**
 * The online play screen: connect, pick a name and role, queue, then play.
 * All game state is the server's; this view only renders it and forwards
 * actions.
 */
export function OnlineView({ onExit }: { onExit: () => void }) {
  const online = useOnlineGame();
  const { state } = online;

  if (state.connection !== 'open' && !state.match) {
    return (
      <div className="panel">
        <h2 className="panel__title">Online play</h2>
        <p className="panel__hint">
          {state.connection === 'connecting'
            ? 'Connecting to server…'
            : 'Connection lost. Reconnecting…'}
        </p>
        <button type="button" className="link-button" onClick={onExit}>
          ← Back
        </button>
      </div>
    );
  }

  if (!state.match || !state.match.snapshot) {
    return <QueueScreen online={online} onExit={onExit} />;
  }

  return <OnlineMatch online={online} onExit={onExit} />;
}

// ---------------------------------------------------------------------------
// Queue screen
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: { id: QueueRole; label: string; description: string }[] = [
  { id: 'brain', label: 'Brain', description: 'You name the piece types.' },
  { id: 'hand', label: 'Hand', description: 'You choose the moves.' },
  { id: 'either', label: 'Either', description: 'Whichever fills a match faster.' },
];

function QueueScreen({
  online,
  onExit,
}: {
  online: ReturnType<typeof useOnlineGame>;
  onExit: () => void;
}) {
  const { state } = online;
  const [draftName, setDraftName] = useState<string | null>(null);

  // Refresh my profile (ratings + history) and the leaderboard whenever the
  // queue screen appears — including after returning from a match.
  useEffect(() => {
    online.fetchProfile();
    online.fetchLeaderboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="setup">
      <h2 className="setup__heading">Online play</h2>

      {state.ratings && (
        <p className="panel__hint">
          Your ratings — Hand: <strong>{state.ratings.hand.rating}</strong> (
          {state.ratings.hand.gamesPlayed} games) · Brain:{' '}
          <strong>{state.ratings.brain.rating}</strong> (
          {state.ratings.brain.gamesPlayed} games)
        </p>
      )}

      <div className="setup__options">
        <label className="setup__field setup__slider">
          Display name
          <span className="name-row">
            <input
              type="text"
              value={draftName ?? state.name}
              maxLength={32}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <button
              type="button"
              className="link-button"
              disabled={draftName === null || draftName.trim() === ''}
              onClick={() => {
                if (draftName && draftName.trim()) {
                  online.setName(draftName.trim());
                  setDraftName(null);
                }
              }}
            >
              Save
            </button>
          </span>
        </label>
      </div>

      {state.queuedAs === null ? (
        <>
          <p className="panel__hint">Queue for a 2v2 match as:</p>
          <div className="mode-grid">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="mode-card"
                onClick={() => online.joinQueue(option.id)}
              >
                <span className="mode-card__label">{option.label}</span>
                <span className="mode-card__description">{option.description}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="panel panel--thinking">
          <h2 className="panel__title">In queue ({state.queuedAs})</h2>
          <p className="panel__hint">Waiting for three more players…</p>
          <button
            type="button"
            className="link-button"
            onClick={online.leaveQueue}
          >
            Leave queue
          </button>
        </div>
      )}

      {state.lastError && <p className="error-text">{state.lastError}</p>}

      <div className="boards">
        {state.leaderboard && (
          <>
            <LeaderboardPanel title="Top Hands" entries={state.leaderboard.hand} />
            <LeaderboardPanel title="Top Brains" entries={state.leaderboard.brain} />
          </>
        )}
        {state.history && state.history.length > 0 && (
          <HistoryPanel history={state.history} />
        )}
      </div>

      <button type="button" className="link-button reset-link" onClick={onExit}>
        ← Back to game modes
      </button>
    </div>
  );
}

function LeaderboardPanel({
  title,
  entries,
}: {
  title: string;
  entries: LeaderboardEntry[];
}) {
  return (
    <div className="panel">
      <h2 className="panel__title">{title}</h2>
      {entries.length === 0 ? (
        <p className="panel__hint">No rated games yet.</p>
      ) : (
        <ol className="board-list">
          {entries.map((entry) => (
            <li key={entry.playerId}>
              <span className="board-list__name">{entry.name}</span>
              <span className="board-list__rating">
                {entry.rating} ({entry.gamesPlayed})
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function HistoryPanel({ history }: { history: MatchHistoryEntry[] }) {
  return (
    <div className="panel">
      <h2 className="panel__title">Recent matches</h2>
      <ul className="board-list">
        {history.slice(0, 8).map((entry) => {
          const won = entry.outcome.winner === entry.seat.color;
          const result =
            entry.outcome.winner === null ? 'Draw' : won ? 'Won' : 'Lost';
          const role = entry.seat.role === Role.Brain ? 'Brain' : 'Hand';
          return (
            <li key={entry.matchId}>
              <span className="board-list__name">
                {result} as {role} with {entry.teammate}
              </span>
              <span className="board-list__rating">{entry.moveCount} moves</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match screen
// ---------------------------------------------------------------------------

function OnlineMatch({
  online,
  onExit,
}: {
  online: ReturnType<typeof useOnlineGame>;
  onExit: () => void;
}) {
  const { state } = online;
  const match = state.match!;
  const snapshot = match.snapshot!;
  const mySeat = match.mySeat;

  const isMyTurnSide = snapshot.turn === mySeat.color;
  const iAmActingBrain =
    isMyTurnSide &&
    mySeat.role === Role.Brain &&
    snapshot.phase === Phase.AwaitingBrain;
  const iAmActingHand =
    isMyTurnSide &&
    mySeat.role === Role.Hand &&
    snapshot.phase === Phase.AwaitingHand;

  const statusTag = describeActor(snapshot, match.players, state.playerId);

  return (
    <PlaySurface
      snapshot={snapshot}
      orientation={mySeat.color === 'w' ? 'white' : 'black'}
      handEnabled={iAmActingHand && !match.outcome}
      onSelectMove={online.selectMove}
      statusTag={statusTag}
      topPanels={
        <>
          <RosterPanel players={match.players} myPlayerId={state.playerId} />

          {iAmActingBrain && !match.outcome && (
            <BrainPanel
              available={snapshot.availablePieceTypes}
              onSelect={online.selectPieceType}
            />
          )}

          {match.outcome && (
            <div className="panel">
              <h2 className="panel__title">
                {describeOutcome(match.outcome, mySeat.color)}
              </h2>
              {state.lastRatingUpdate && (
                <p className="panel__hint">
                  {state.lastRatingUpdate.role === Role.Brain ? 'Brain' : 'Hand'}{' '}
                  rating: {state.lastRatingUpdate.before.rating} →{' '}
                  <strong>{state.lastRatingUpdate.after.rating}</strong>
                </p>
              )}
              <div className="panel__actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={online.leaveFinishedMatch}
                >
                  Back to queue
                </button>
              </div>
            </div>
          )}
        </>
      }
      bottomPanels={
        <>
          <MoveHistory history={snapshot.history} />
          {state.lastError && <p className="error-text">{state.lastError}</p>}
          {!match.outcome && (
            <button
              type="button"
              className="link-button reset-link"
              onClick={online.resign}
            >
              Resign
            </button>
          )}
          {match.outcome && (
            <button type="button" className="link-button reset-link" onClick={onExit}>
              ← Leave online play
            </button>
          )}
        </>
      }
    />
  );
}

function RosterPanel({
  players,
  myPlayerId,
}: {
  players: MatchPlayerInfo[];
  myPlayerId: string | null;
}) {
  const bySeat = (color: 'w' | 'b', role: Role) =>
    players.find((p) => p.seat.color === color && p.seat.role === role);

  const seatRow = (color: 'w' | 'b', role: Role) => {
    const player = bySeat(color, role);
    if (!player) return null;
    return (
      <li key={`${color}-${role}`} className="roster__row">
        <span className="roster__seat">
          {color === 'w' ? 'White' : 'Black'} {role === Role.Brain ? 'Brain' : 'Hand'}
        </span>
        <span
          className={`roster__name${player.connected ? '' : ' roster__name--offline'}`}
        >
          {player.name}
          {player.playerId === myPlayerId ? ' (you)' : ''}
          {player.connected ? '' : ' — disconnected'}
        </span>
      </li>
    );
  };

  return (
    <div className="panel">
      <h2 className="panel__title">Players</h2>
      <ul className="roster">
        {seatRow('w', Role.Brain)}
        {seatRow('w', Role.Hand)}
        {seatRow('b', Role.Brain)}
        {seatRow('b', Role.Hand)}
      </ul>
    </div>
  );
}

/** A "(you)" / "(teammate)" / "(opponents)" tag for the status banner. */
function describeActor(
  snapshot: { turn: 'w' | 'b'; phase: Phase },
  players: MatchPlayerInfo[],
  myPlayerId: string | null,
): string {
  const actingRole =
    snapshot.phase === Phase.AwaitingBrain ? Role.Brain : Role.Hand;
  const actor = players.find(
    (p) => p.seat.color === snapshot.turn && p.seat.role === actingRole,
  );
  if (!actor || !myPlayerId) return '';
  if (actor.playerId === myPlayerId) return '(you)';
  const me = players.find((p) => p.playerId === myPlayerId);
  return me && me.seat.color === actor.seat.color ? '(teammate)' : '(opponents)';
}

function describeOutcome(
  outcome: NonNullable<NonNullable<ReturnType<typeof useOnlineGame>['state']['match']>['outcome']>,
  myColor: 'w' | 'b',
): string {
  if (outcome.winner === null) return 'Draw';
  const won = outcome.winner === myColor;
  const how = outcome.by === 'resignation' ? 'by resignation' : '';
  return `${won ? 'Your team wins' : 'Your team loses'} ${how}`.trim();
}
