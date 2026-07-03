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
  type RoomMemberInfo,
  type SeatAssignment,
  type ServerMessage,
  sanitizeName,
} from '@hnb/core';
import {
  seatPlanPlayers,
  tryFormMatch,
  type QueueEntry,
  type SeatPlan,
} from './matchmaking';
import { Match, MatchActionError } from './match';
import { RatingBook } from './ratings';
import { MatchLog } from './history';
import type { Store } from './store';

export interface Transport {
  send(playerId: string, message: ServerMessage): void;
}

interface Player {
  id: string;
  token: string;
  name: string;
  connected: boolean;
  matchId: string | null;
  /** Code of the private room the player is a member of, if any. */
  roomCode: string | null;
}

/**
 * A private room: friends gather by invite code, claim the four seats, and
 * the host starts the match. The room survives the match, so the same group
 * can rematch (or swap seats) without re-inviting. Rooms are transient —
 * never persisted — and dissolve when the last member leaves.
 */
interface Room {
  code: string;
  hostId: string;
  /** Insertion order = join order (used to promote a new host). */
  seats: Map<string, SeatAssignment | null>;
}

/** Room codes avoid ambiguous characters (0/O, 1/I). */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 5;
const ROOM_CAPACITY = 6; // four players + a couple of swap-ins

export interface LobbyOptions {
  /** How long a disconnected player's team survives before forfeiting. */
  abandonTimeoutMs?: number;
  /** Durable storage for identities, ratings, and history. Omit for none. */
  store?: Store;
}

const DEFAULT_ABANDON_TIMEOUT_MS = 60_000;

export class Lobby {
  private readonly playersById = new Map<string, Player>();
  private readonly playersByToken = new Map<string, Player>();
  private readonly matches = new Map<string, Match>();
  private readonly rooms = new Map<string, Room>();
  private queue: QueueEntry[] = [];
  private readonly abandonTimers = new Map<string, NodeJS.Timeout>();
  private readonly abandonTimeoutMs: number;
  private readonly ratings = new RatingBook();
  private readonly matchLog = new MatchLog();
  private readonly store: Store | undefined;

  constructor(
    private readonly transport: Transport,
    options: LobbyOptions = {},
  ) {
    this.abandonTimeoutMs =
      options.abandonTimeoutMs ?? DEFAULT_ABANDON_TIMEOUT_MS;
    this.store = options.store;
    this.hydrateFromStore();
  }

  /** Restore persisted identities, ratings, and history on startup. */
  private hydrateFromStore(): void {
    const snapshot = this.store?.load();
    if (!snapshot) return;

    for (const persisted of snapshot.players) {
      const player: Player = {
        id: persisted.id,
        token: persisted.token,
        name: persisted.name,
        connected: false,
        matchId: null, // live matches are never persisted
        roomCode: null, // rooms are transient
      };
      this.playersById.set(player.id, player);
      this.playersByToken.set(player.token, player);
      this.ratings.hydrate(player.id, persisted.ratings);
    }
    this.matchLog.hydrate(snapshot.matches);
  }

  /** Persist the durable subset of state (no-op when no store is configured). */
  private persist(): void {
    if (!this.store) return;
    this.store.save({
      version: 1,
      players: [...this.playersById.values()].map((player) => ({
        id: player.id,
        token: player.token,
        name: player.name,
        ratings: this.ratings.ratingsOf(player.id),
      })),
      matches: this.matchLog.all(),
    });
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
      const clean = sanitizeName(name);
      if (clean && clean !== player.name) {
        player.name = clean;
        this.persist(); // remember the name a client introduced itself with
      }
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

    // Back in a room (e.g. reconnected while a match was in progress):
    // refresh everyone's member list so connection status updates.
    const room = player.roomCode ? this.rooms.get(player.roomCode) : undefined;
    if (room) this.broadcastRoomState(room);

    return player.id;
  }

  /** The connection bound to this player dropped. */
  disconnect(playerId: string): void {
    const player = this.playersById.get(playerId);
    if (!player) return;
    player.connected = false;

    this.removeFromQueue(playerId);

    const match = player.matchId ? this.matches.get(player.matchId) : undefined;

    // A dropped lobby member leaves their room immediately (the client
    // auto-rejoins by code on reconnect). Mid-match members stay: they may
    // reconnect into the game, and the room should still be there after.
    if (!match || match.isFinished()) {
      this.leaveRoom(player);
    } else if (player.roomCode) {
      const room = this.rooms.get(player.roomCode);
      if (room) this.broadcastRoomState(room); // show them as disconnected
    }

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
        this.persist();
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
      case 'room-create':
        this.handleRoomCreate(player);
        return;
      case 'room-join':
        this.handleRoomJoin(player, message.code);
        return;
      case 'room-seat':
        this.handleRoomSeat(player, { color: message.color, role: message.role });
        return;
      case 'room-unseat':
        this.handleRoomSeat(player, null);
        return;
      case 'room-leave':
        this.leaveRoom(player);
        return;
      case 'room-start':
        this.handleRoomStart(player);
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
    this.startMatch(formed.seats);
  }

  /** Create a match for a full seat plan and notify all four players. */
  private startMatch(seats: SeatPlan): void {
    const match = new Match(randomUUID(), seats);
    this.matches.set(match.id, match);
    for (const id of seatPlanPlayers(seats)) {
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
    this.persist(); // ratings + history changed
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
  // Private rooms
  // -------------------------------------------------------------------------

  private handleRoomCreate(player: Player): void {
    if (player.matchId) {
      this.sendError(player.id, 'illegal-action', 'You are already in a match.');
      return;
    }
    this.leaveRoom(player); // at most one room at a time
    this.removeFromQueue(player.id); // creating a room supersedes queueing

    const room: Room = {
      code: this.generateRoomCode(),
      hostId: player.id,
      seats: new Map([[player.id, null]]),
    };
    this.rooms.set(room.code, room);
    player.roomCode = room.code;
    this.broadcastRoomState(room);
  }

  private handleRoomJoin(player: Player, code: string): void {
    if (player.matchId) {
      this.sendError(player.id, 'illegal-action', 'You are already in a match.');
      return;
    }
    const room = this.rooms.get(code);
    if (!room) {
      this.sendError(player.id, 'no-such-room', `No room with code ${code}.`);
      return;
    }
    if (room.seats.has(player.id)) {
      this.broadcastRoomState(room); // idempotent re-join (e.g. reconnect)
      return;
    }
    if (room.seats.size >= ROOM_CAPACITY) {
      this.sendError(player.id, 'room-full', 'That room is full.');
      return;
    }
    this.leaveRoom(player);
    this.removeFromQueue(player.id);
    room.seats.set(player.id, null);
    player.roomCode = room.code;
    this.broadcastRoomState(room);
  }

  /** Claim a seat (or vacate with null). Distinct seats are enforced here. */
  private handleRoomSeat(player: Player, seat: SeatAssignment | null): void {
    const room = player.roomCode ? this.rooms.get(player.roomCode) : undefined;
    if (!room) {
      this.sendError(player.id, 'no-such-room', 'You are not in a room.');
      return;
    }
    if (seat) {
      const taken = [...room.seats.entries()].some(
        ([id, s]) =>
          id !== player.id &&
          s !== null &&
          s.color === seat.color &&
          s.role === seat.role,
      );
      if (taken) {
        this.sendError(player.id, 'seat-taken', 'That seat is already taken.');
        return;
      }
    }
    room.seats.set(player.id, seat);
    this.broadcastRoomState(room);
  }

  private handleRoomStart(player: Player): void {
    const room = player.roomCode ? this.rooms.get(player.roomCode) : undefined;
    if (!room) {
      this.sendError(player.id, 'no-such-room', 'You are not in a room.');
      return;
    }
    if (room.hostId !== player.id) {
      this.sendError(player.id, 'not-host', 'Only the host can start the match.');
      return;
    }

    // All four seats must be claimed by connected members.
    const seated = new Map<string, string>(); // "color-role" -> playerId
    for (const [id, seat] of room.seats) {
      if (!seat) continue;
      if (!this.playersById.get(id)?.connected) {
        this.sendError(player.id, 'room-not-ready', 'A seated player is disconnected.');
        return;
      }
      seated.set(`${seat.color}-${seat.role}`, id);
    }
    if (seated.size < 4) {
      this.sendError(player.id, 'room-not-ready', 'All four seats must be filled.');
      return;
    }

    const seats: SeatPlan = {
      w: { brain: seated.get(`w-${Role.Brain}`)!, hand: seated.get(`w-${Role.Hand}`)! },
      b: { brain: seated.get(`b-${Role.Brain}`)!, hand: seated.get(`b-${Role.Hand}`)! },
    };
    // The room stays alive through the match so the group can rematch.
    this.startMatch(seats);
  }

  /** Remove a player from their room (if any), promoting or dissolving. */
  private leaveRoom(player: Player): void {
    const room = player.roomCode ? this.rooms.get(player.roomCode) : undefined;
    player.roomCode = null;
    if (!room) return;

    room.seats.delete(player.id);
    if (room.seats.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id) {
      // Promote the earliest-joined remaining member.
      room.hostId = room.seats.keys().next().value!;
    }
    this.broadcastRoomState(room);
  }

  private broadcastRoomState(room: Room): void {
    const members: RoomMemberInfo[] = [...room.seats.entries()].map(
      ([id, seat]) => {
        const member = this.playersById.get(id)!;
        return {
          playerId: id,
          name: member.name,
          connected: member.connected,
          seat,
        };
      },
    );
    const message: ServerMessage = {
      type: 'room-state',
      code: room.code,
      hostId: room.hostId,
      members,
    };
    for (const id of room.seats.keys()) {
      this.send(id, message);
    }
  }

  private generateRoomCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
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
      roomCode: null,
    };
    // NOTE: identities are retained for the process lifetime (Phase 2 is
    // memory-only); Phase 3 moves identity to the database.
    this.playersById.set(id, player);
    this.playersByToken.set(player.token, player);
    this.persist(); // remember the new identity + token
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
