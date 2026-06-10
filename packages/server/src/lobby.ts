/**
 * The Lobby is the server's hub: player identities, the matchmaking queue,
 * and all active matches. It is deliberately socket-free — outbound messages
 * go through an injected Transport — so the whole online flow can be unit
 * tested without networking.
 *
 * Identity model (Phase 2): anonymous players. Each new client receives a
 * random session token; presenting the same token on a later connection
 * re-attaches the client to its identity and any active match. Phase 3
 * replaces this with real accounts while keeping the same message flow.
 */
import { randomUUID } from 'node:crypto';
import {
  Role,
  type ClientMessage,
  type Color,
  type ErrorCode,
  type LeaderboardEntry,
  type MatchPlayerInfo,
  type ServerMessage,
  sanitizeName,
} from '@hnb/core';
import {
  seatPlanPlayers,
  tryFormMatch,
  type QueueEntry,
} from './matchmaking';
import { Match, MatchActionError } from './match';
import { RatingBook } from './ratings';
import { MatchLog } from './history';

export interface Transport {
  send(playerId: string, message: ServerMessage): void;
}

interface Player {
  id: string;
  token: string;
  name: string;
  connected: boolean;
  matchId: string | null;
}

export interface LobbyOptions {
  /** How long a disconnected player's team survives before forfeiting. */
  abandonTimeoutMs?: number;
}

const DEFAULT_ABANDON_TIMEOUT_MS = 60_000;

export class Lobby {
  private readonly playersById = new Map<string, Player>();
  private readonly playersByToken = new Map<string, Player>();
  private readonly matches = new Map<string, Match>();
  private queue: QueueEntry[] = [];
  private readonly abandonTimers = new Map<string, NodeJS.Timeout>();
  private readonly abandonTimeoutMs: number;
  private readonly ratings = new RatingBook();
  private readonly matchLog = new MatchLog();

  constructor(
    private readonly transport: Transport,
    options: LobbyOptions = {},
  ) {
    this.abandonTimeoutMs =
      options.abandonTimeoutMs ?? DEFAULT_ABANDON_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /**
   * A client said hello. Returns the player id the caller should bind this
   * connection to. A valid token re-attaches the existing identity (and any
   * active match); otherwise a fresh identity is created.
   *
   * `bindConnection` is invoked with the player id BEFORE any messages are
   * sent, so the connection layer can route the welcome (and everything
   * after) to the right socket.
   */
  hello(
    token: string | undefined,
    name: string | undefined,
    bindConnection?: (playerId: string) => void,
  ): string {
    const existing = token ? this.playersByToken.get(token) : undefined;
    const player = existing ?? this.createPlayer();
    if (name) {
      player.name = sanitizeName(name) ?? player.name;
    }
    player.connected = true;
    bindConnection?.(player.id);

    this.send(player.id, {
      type: 'welcome',
      playerId: player.id,
      token: player.token,
      name: player.name,
      activeMatchId: player.matchId,
      ratings: this.ratings.ratingsOf(player.id),
    });

    const match = player.matchId ? this.matches.get(player.matchId) : undefined;
    if (match) {
      // Reconnection into a live match: rebuild the client's full context and
      // tell the other players their teammate/opponent is back.
      this.cancelAbandonTimer(player.id);
      this.send(player.id, {
        type: 'match-found',
        matchId: match.id,
        yourSeat: match.seatOfPlayer(player.id)!,
        players: this.matchPlayers(match),
      });
      this.sendMatchState(match, [player.id]);
      this.broadcastConnection(match, player, true);
    }
    return player.id;
  }

  /** The connection bound to this player dropped. */
  disconnect(playerId: string): void {
    const player = this.playersById.get(playerId);
    if (!player) return;
    player.connected = false;

    this.removeFromQueue(playerId);

    const match = player.matchId ? this.matches.get(player.matchId) : undefined;
    if (match && !match.isFinished()) {
      this.broadcastConnection(match, player, false);
      // The disconnected player's team forfeits if they stay away too long.
      const seat = match.seatOfPlayer(playerId)!;
      this.abandonTimers.set(
        playerId,
        setTimeout(() => this.forfeitByAbandonment(match.id, seat.color), this.abandonTimeoutMs),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  handleMessage(playerId: string, message: ClientMessage): void {
    const player = this.playersById.get(playerId);
    if (!player) return;

    switch (message.type) {
      case 'hello':
        // hello is handled by the connection layer; ignore duplicates here.
        return;
      case 'set-name':
        player.name = message.name;
        return;
      case 'queue-join':
        this.handleQueueJoin(player, message.role);
        return;
      case 'queue-leave':
        this.removeFromQueue(player.id);
        this.send(player.id, { type: 'queue-status', queued: false });
        return;
      case 'select-piece-type':
        this.handleGameAction(player, message.matchId, (match) =>
          match.selectPieceType(player.id, message.pieceType),
        );
        return;
      case 'select-move':
        this.handleGameAction(player, message.matchId, (match) =>
          match.selectMove(player.id, {
            from: message.from,
            to: message.to,
            promotion: message.promotion,
          }),
        );
        return;
      case 'resign':
        this.handleGameAction(player, message.matchId, (match) =>
          match.resign(player.id),
        );
        return;
      case 'get-leaderboard':
        this.send(player.id, {
          type: 'leaderboard',
          hand: this.leaderboard(Role.Hand),
          brain: this.leaderboard(Role.Brain),
        });
        return;
      case 'get-profile':
        this.send(player.id, {
          type: 'profile',
          playerId: player.id,
          name: player.name,
          ratings: this.ratings.ratingsOf(player.id),
          history: this.matchLog.forPlayer(player.id),
        });
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  private handleQueueJoin(player: Player, role: QueueEntry['role']): void {
    if (player.matchId) {
      this.sendError(player.id, 'illegal-action', 'You are already in a match.');
      return;
    }
    if (this.queue.some((e) => e.playerId === player.id)) {
      this.sendError(player.id, 'already-queued', 'You are already queued.');
      return;
    }

    this.queue.push({ playerId: player.id, role, joinedAt: Date.now() });
    this.send(player.id, { type: 'queue-status', queued: true, role });

    const formed = tryFormMatch(this.queue, (playerId, seatRole) =>
      this.ratings.relevantRating(playerId, seatRole),
    );
    if (!formed) return;
    this.queue = formed.remaining;

    const match = new Match(randomUUID(), formed.seats);
    this.matches.set(match.id, match);
    for (const id of seatPlanPlayers(formed.seats)) {
      const participant = this.playersById.get(id)!;
      participant.matchId = match.id;
      this.send(id, {
        type: 'match-found',
        matchId: match.id,
        yourSeat: match.seatOfPlayer(id)!,
        players: this.matchPlayers(match),
      });
    }
    this.sendMatchState(match);
  }

  private removeFromQueue(playerId: string): void {
    this.queue = this.queue.filter((e) => e.playerId !== playerId);
  }

  // -------------------------------------------------------------------------
  // Match actions
  // -------------------------------------------------------------------------

  private handleGameAction(
    player: Player,
    matchId: string,
    action: (match: Match) => void,
  ): void {
    const match = this.matches.get(matchId);
    if (!match || player.matchId !== matchId) {
      this.sendError(player.id, 'not-in-match', 'No such active match for you.');
      return;
    }

    try {
      action(match);
    } catch (error) {
      if (error instanceof MatchActionError) {
        this.sendError(player.id, error.code, error.message);
        return;
      }
      throw error;
    }

    this.sendMatchState(match);
    if (match.isFinished()) {
      this.finishMatch(match);
    }
  }

  private forfeitByAbandonment(matchId: string, color: Color): void {
    const match = this.matches.get(matchId);
    if (!match || match.isFinished()) return;
    match.forfeit(color);
    this.sendMatchState(match);
    this.finishMatch(match);
  }

  private finishMatch(match: Match): void {
    const outcome = match.outcome()!;

    // Rate the game and tell each player how their role rating moved.
    const changes = this.ratings.applyMatchResult(match.seats, outcome.winner);
    for (const change of changes) {
      this.send(change.playerId, {
        type: 'rating-update',
        matchId: match.id,
        role: change.role,
        before: change.before,
        after: change.after,
      });
    }

    this.matchLog.add({
      matchId: match.id,
      endedAt: Date.now(),
      players: this.matchPlayers(match).map((p) => ({
        playerId: p.playerId,
        name: p.name,
        seat: p.seat,
      })),
      outcome,
      moveCount: match.snapshot().history.length,
    });

    for (const id of seatPlanPlayers(match.seats)) {
      const player = this.playersById.get(id);
      if (player && player.matchId === match.id) {
        player.matchId = null;
      }
      this.cancelAbandonTimer(id);
    }
    this.matches.delete(match.id);
  }

  /** Top rated players for one role, best first. */
  private leaderboard(role: Role, limit = 10): LeaderboardEntry[] {
    return this.ratings
      .ratedPlayers(role)
      .sort((a, b) => b.state.rating - a.state.rating)
      .slice(0, limit)
      .map(({ playerId, state }) => ({
        playerId,
        name: this.playersById.get(playerId)?.name ?? 'Unknown',
        rating: state.rating,
        gamesPlayed: state.gamesPlayed,
      }));
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  private matchPlayers(match: Match): MatchPlayerInfo[] {
    return seatPlanPlayers(match.seats).map((id) => {
      const player = this.playersById.get(id)!;
      return {
        playerId: player.id,
        name: player.name,
        seat: match.seatOfPlayer(id)!,
        connected: player.connected,
      };
    });
  }

  /** Send the authoritative state to all participants (or a subset). */
  private sendMatchState(match: Match, onlyTo?: string[]): void {
    const message: ServerMessage = {
      type: 'match-state',
      matchId: match.id,
      snapshot: match.snapshot(),
      players: this.matchPlayers(match),
      outcome: match.outcome(),
    };
    for (const id of onlyTo ?? seatPlanPlayers(match.seats)) {
      this.send(id, message);
    }
  }

  private broadcastConnection(
    match: Match,
    about: Player,
    connected: boolean,
  ): void {
    for (const id of seatPlanPlayers(match.seats)) {
      if (id !== about.id) {
        this.send(id, {
          type: 'player-connection',
          matchId: match.id,
          playerId: about.id,
          connected,
        });
      }
    }
  }

  private send(playerId: string, message: ServerMessage): void {
    this.transport.send(playerId, message);
  }

  private sendError(playerId: string, code: ErrorCode, message: string): void {
    this.send(playerId, { type: 'error-message', code, message });
  }

  private createPlayer(): Player {
    const id = randomUUID();
    const player: Player = {
      id,
      token: randomUUID(),
      name: `Player-${id.slice(0, 4)}`,
      connected: true,
      matchId: null,
    };
    // NOTE: identities are retained for the process lifetime (Phase 2 is
    // memory-only); Phase 3 moves identity to the database.
    this.playersById.set(id, player);
    this.playersByToken.set(player.token, player);
    return player;
  }

  private cancelAbandonTimer(playerId: string): void {
    const timer = this.abandonTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.abandonTimers.delete(playerId);
    }
  }
}
