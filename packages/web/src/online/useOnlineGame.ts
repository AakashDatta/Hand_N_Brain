import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GameSnapshot,
  LeaderboardEntry,
  LegalMove,
  MatchHistoryEntry,
  MatchOutcome,
  MatchPlayerInfo,
  PieceType,
  PlayerRatings,
  QueueRole,
  RatingState,
  Role,
  SeatAssignment,
} from '@hnb/core';
import { GameSocket, type ConnectionStatus } from './connection';

/**
 * The full state of an online session, derived purely from server messages.
 * The server is authoritative: the client renders whatever state arrives and
 * never applies moves locally.
 */
export interface OnlineState {
  connection: ConnectionStatus;
  playerId: string | null;
  name: string;
  queuedAs: QueueRole | null;
  match: {
    matchId: string;
    mySeat: SeatAssignment;
    players: MatchPlayerInfo[];
    /** Null only in the instant between match-found and the first state. */
    snapshot: GameSnapshot | null;
    outcome: MatchOutcome | null;
  } | null;
  /** Most recent server-rejected action, for display. */
  lastError: string | null;
  /** My two role ratings, kept fresh by welcome and rating updates. */
  ratings: PlayerRatings | null;
  /** My rating change from the most recently finished match. */
  lastRatingUpdate: { role: Role; before: RatingState; after: RatingState } | null;
  leaderboard: { hand: LeaderboardEntry[]; brain: LeaderboardEntry[] } | null;
  history: MatchHistoryEntry[] | null;
}

export interface OnlineController {
  state: OnlineState;
  setName: (name: string) => void;
  joinQueue: (role: QueueRole) => void;
  leaveQueue: () => void;
  selectPieceType: (pieceType: PieceType) => void;
  selectMove: (move: {
    from: string;
    to: string;
    promotion?: LegalMove['promotion'];
  }) => void;
  resign: () => void;
  /** Dismiss a finished match and return to the queue screen. */
  leaveFinishedMatch: () => void;
  fetchLeaderboard: () => void;
  fetchProfile: () => void;
}

const INITIAL_STATE: OnlineState = {
  connection: 'connecting',
  playerId: null,
  name: '',
  queuedAs: null,
  match: null,
  lastError: null,
  ratings: null,
  lastRatingUpdate: null,
  leaderboard: null,
  history: null,
};

export function useOnlineGame(initialName?: string): OnlineController {
  const [state, setState] = useState<OnlineState>(INITIAL_STATE);
  const socketRef = useRef<GameSocket | null>(null);

  useEffect(() => {
    const socket = new GameSocket(undefined, initialName);
    socketRef.current = socket;

    socket.onStatus = (connection) => {
      setState((prev) => ({
        ...prev,
        connection,
        // A dropped connection invalidates queue membership (the server
        // removes us); match context survives for the reconnect.
        queuedAs: connection === 'open' ? prev.queuedAs : null,
      }));
    };

    socket.onMessage = (message) => {
      switch (message.type) {
        case 'welcome':
          setState((prev) => ({
            ...prev,
            playerId: message.playerId,
            name: message.name,
            ratings: message.ratings,
            // If no active match, any stale match view is over.
            match: message.activeMatchId ? prev.match : null,
          }));
          return;
        case 'queue-status':
          setState((prev) => ({
            ...prev,
            queuedAs: message.queued ? (message.role ?? 'either') : null,
          }));
          return;
        case 'match-found':
          setState((prev) => ({
            ...prev,
            queuedAs: null,
            lastRatingUpdate: null,
            match: {
              matchId: message.matchId,
              mySeat: message.yourSeat,
              players: message.players,
              // The authoritative snapshot follows immediately in match-state.
              snapshot: prev.match?.snapshot ?? null,
              outcome: null,
            },
          }));
          return;
        case 'match-state':
          setState((prev) => {
            if (!prev.match || prev.match.matchId !== message.matchId) {
              return prev;
            }
            return {
              ...prev,
              match: {
                ...prev.match,
                snapshot: message.snapshot,
                players: message.players,
                outcome: message.outcome,
              },
            };
          });
          return;
        case 'player-connection':
          setState((prev) => {
            if (!prev.match || prev.match.matchId !== message.matchId) {
              return prev;
            }
            return {
              ...prev,
              match: {
                ...prev.match,
                players: prev.match.players.map((p) =>
                  p.playerId === message.playerId
                    ? { ...p, connected: message.connected }
                    : p,
                ),
              },
            };
          });
          return;
        case 'rating-update':
          setState((prev) => ({
            ...prev,
            lastRatingUpdate: {
              role: message.role,
              before: message.before,
              after: message.after,
            },
            ratings: prev.ratings
              ? {
                  ...prev.ratings,
                  [message.role === 'HAND' ? 'hand' : 'brain']: message.after,
                }
              : prev.ratings,
          }));
          return;
        case 'leaderboard':
          setState((prev) => ({
            ...prev,
            leaderboard: { hand: message.hand, brain: message.brain },
          }));
          return;
        case 'profile':
          setState((prev) => ({
            ...prev,
            ratings: message.ratings,
            history: message.history,
          }));
          return;
        case 'error-message':
          setState((prev) => ({ ...prev, lastError: message.message }));
          return;
      }
    };

    socket.connect();
    return () => {
      socket.dispose();
      socketRef.current = null;
    };
    // The socket lives for the lifetime of the online screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(() => {
    const send = (fn: (socket: GameSocket) => void) => {
      const socket = socketRef.current;
      if (socket) fn(socket);
    };

    return {
      state,
      setName: (name) => {
        send((s) => s.setName(name));
        setState((prev) => ({ ...prev, name }));
      },
      joinQueue: (role) =>
        send((s) => s.send({ type: 'queue-join', role })),
      leaveQueue: () => send((s) => s.send({ type: 'queue-leave' })),
      selectPieceType: (pieceType) =>
        send((s) => {
          const matchId = state.match?.matchId;
          if (matchId) s.send({ type: 'select-piece-type', matchId, pieceType });
        }),
      selectMove: (move) =>
        send((s) => {
          const matchId = state.match?.matchId;
          if (matchId) s.send({ type: 'select-move', matchId, ...move });
        }),
      resign: () =>
        send((s) => {
          const matchId = state.match?.matchId;
          if (matchId) s.send({ type: 'resign', matchId });
        }),
      leaveFinishedMatch: () =>
        setState((prev) =>
          prev.match?.outcome ? { ...prev, match: null } : prev,
        ),
      fetchLeaderboard: () => send((s) => s.send({ type: 'get-leaderboard' })),
      fetchProfile: () => send((s) => s.send({ type: 'get-profile' })),
    } satisfies OnlineController;
  }, [state]);
}
