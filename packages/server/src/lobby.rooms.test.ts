import { beforeEach, describe, expect, it } from 'vitest';
import { Role, type ServerMessage } from '@hnb/core';
import { Lobby } from './lobby';

/** Private-room flows: create/join by code, seats, host start, rematch. */

class FakeTransport {
  readonly inbox = new Map<string, ServerMessage[]>();
  send(playerId: string, message: ServerMessage): void {
    const list = this.inbox.get(playerId) ?? [];
    list.push(message);
    this.inbox.set(playerId, list);
  }
  last<T extends ServerMessage['type']>(playerId: string, type: T) {
    const all = (this.inbox.get(playerId) ?? []).filter(
      (m): m is Extract<ServerMessage, { type: T }> => m.type === type,
    );
    return all[all.length - 1];
  }
  count(playerId: string, type: ServerMessage['type']): number {
    return (this.inbox.get(playerId) ?? []).filter((m) => m.type === type).length;
  }
}

let transport: FakeTransport;
let lobby: Lobby;

beforeEach(() => {
  transport = new FakeTransport();
  lobby = new Lobby(transport, { abandonTimeoutMs: 1000 });
});

/** Create a room with a host and three joiners; returns ids + code. */
function assembleRoom() {
  const host = lobby.hello(undefined, 'Host');
  lobby.handleMessage(host, { type: 'room-create' });
  const code = transport.last(host, 'room-state').code;

  const guests = ['G1', 'G2', 'G3'].map((name) => {
    const id = lobby.hello(undefined, name);
    lobby.handleMessage(id, { type: 'room-join', code });
    return id;
  });
  return { host, guests, code, all: [host, ...guests] };
}

function seatEveryone(ids: string[]) {
  const seats = [
    { color: 'w', role: Role.Brain },
    { color: 'w', role: Role.Hand },
    { color: 'b', role: Role.Brain },
    { color: 'b', role: Role.Hand },
  ] as const;
  ids.forEach((id, i) =>
    lobby.handleMessage(id, { type: 'room-seat', ...seats[i] }),
  );
}

describe('creating and joining', () => {
  it('creates a room with a join code and hosts the creator', () => {
    const host = lobby.hello(undefined, 'Host');
    lobby.handleMessage(host, { type: 'room-create' });

    const state = transport.last(host, 'room-state');
    expect(state.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(state.hostId).toBe(host);
    expect(state.members).toHaveLength(1);
    expect(state.members[0].seat).toBeNull();
  });

  it('lets friends join by code and broadcasts to everyone', () => {
    const { all, code } = assembleRoom();
    for (const id of all) {
      const state = transport.last(id, 'room-state');
      expect(state.code).toBe(code);
      expect(state.members).toHaveLength(4);
    }
  });

  it('rejects a bad code and a full room', () => {
    const { code } = assembleRoom();
    const stranger = lobby.hello(undefined, 'Stray');
    lobby.handleMessage(stranger, { type: 'room-join', code: 'ZZZZZ' });
    expect(transport.last(stranger, 'error-message').code).toBe('no-such-room');

    // Fill to capacity (6), then one more is rejected.
    const e1 = lobby.hello(undefined, 'E1');
    const e2 = lobby.hello(undefined, 'E2');
    lobby.handleMessage(e1, { type: 'room-join', code });
    lobby.handleMessage(e2, { type: 'room-join', code });
    const e3 = lobby.hello(undefined, 'E3');
    lobby.handleMessage(e3, { type: 'room-join', code });
    expect(transport.last(e3, 'error-message').code).toBe('room-full');
  });

  it('joining a room removes the player from the matchmaking queue', () => {
    const { code } = assembleRoom();
    const queued = lobby.hello(undefined, 'Queued');
    lobby.handleMessage(queued, { type: 'queue-join', role: 'either' });
    lobby.handleMessage(queued, { type: 'room-join', code });

    // Three more queue players should NOT complete a match with them.
    for (const name of ['Q1', 'Q2', 'Q3']) {
      const id = lobby.hello(undefined, name);
      lobby.handleMessage(id, { type: 'queue-join', role: 'either' });
    }
    expect(transport.count(queued, 'match-found')).toBe(0);
  });
});

describe('seats', () => {
  it('claims distinct seats and rejects a taken seat', () => {
    const { host, guests } = assembleRoom();
    lobby.handleMessage(host, { type: 'room-seat', color: 'w', role: Role.Brain });
    lobby.handleMessage(guests[0], { type: 'room-seat', color: 'w', role: Role.Brain });
    expect(transport.last(guests[0], 'error-message').code).toBe('seat-taken');

    // Moving to another seat frees the old one.
    lobby.handleMessage(host, { type: 'room-seat', color: 'b', role: Role.Hand });
    lobby.handleMessage(guests[0], { type: 'room-seat', color: 'w', role: Role.Brain });
    const state = transport.last(host, 'room-state');
    const seatOf = (id: string) => state.members.find((m) => m.playerId === id)!.seat;
    expect(seatOf(host)).toEqual({ color: 'b', role: Role.Hand });
    expect(seatOf(guests[0])).toEqual({ color: 'w', role: Role.Brain });
  });

  it('unseat vacates the seat', () => {
    const { host } = assembleRoom();
    lobby.handleMessage(host, { type: 'room-seat', color: 'w', role: Role.Hand });
    lobby.handleMessage(host, { type: 'room-unseat' });
    const state = transport.last(host, 'room-state');
    expect(state.members.find((m) => m.playerId === host)!.seat).toBeNull();
  });
});

describe('starting a match', () => {
  it('only the host may start, and only with four seated members', () => {
    const { host, guests, all } = assembleRoom();

    lobby.handleMessage(guests[0], { type: 'room-start' });
    expect(transport.last(guests[0], 'error-message').code).toBe('not-host');

    lobby.handleMessage(host, { type: 'room-start' });
    expect(transport.last(host, 'error-message').code).toBe('room-not-ready');

    seatEveryone(all);
    lobby.handleMessage(host, { type: 'room-start' });
    for (const id of all) {
      const found = transport.last(id, 'match-found');
      expect(found).toBeDefined();
      // Seats in the match are exactly the seats claimed in the room.
      const state = transport.last(id, 'room-state');
      const claimed = state.members.find((m) => m.playerId === id)!.seat;
      expect(found.yourSeat).toEqual(claimed);
    }
  });

  it('the room survives the match for a rematch with the same code', () => {
    const { host, all, code } = assembleRoom();
    seatEveryone(all);
    lobby.handleMessage(host, { type: 'room-start' });
    const matchId = transport.last(host, 'match-found').matchId;

    // End it quickly: White Hand resigns.
    const whiteHand = all[1];
    lobby.handleMessage(whiteHand, { type: 'resign', matchId });
    expect(transport.last(host, 'match-state').outcome).not.toBeNull();

    // Host starts again — same room, same seats, brand-new match.
    lobby.handleMessage(host, { type: 'room-start' });
    const rematch = transport.last(host, 'match-found');
    expect(rematch.matchId).not.toBe(matchId);
    expect(transport.last(host, 'room-state').code).toBe(code);
  });
});

describe('leaving and host handoff', () => {
  it('promotes the next member when the host leaves; dissolves when empty', () => {
    const { host, guests } = assembleRoom();
    lobby.handleMessage(host, { type: 'room-leave' });

    const state = transport.last(guests[0], 'room-state');
    expect(state.hostId).toBe(guests[0]);
    expect(state.members).toHaveLength(3);

    for (const g of guests) lobby.handleMessage(g, { type: 'room-leave' });
    // Room is gone: rejoining by the old code fails.
    const again = lobby.hello(undefined, 'Again');
    lobby.handleMessage(again, { type: 'room-join', code: state.code });
    expect(transport.last(again, 'error-message').code).toBe('no-such-room');
  });

  it('a lobby member who disconnects is removed from the room', () => {
    const { host, guests } = assembleRoom();
    lobby.disconnect(guests[2]);
    const state = transport.last(host, 'room-state');
    expect(state.members.map((m) => m.playerId)).not.toContain(guests[2]);
  });

  it('a mid-match member stays in the room while disconnected', () => {
    const { host, all } = assembleRoom();
    seatEveryone(all);
    lobby.handleMessage(host, { type: 'room-start' });

    lobby.disconnect(all[3]);
    const state = transport.last(host, 'room-state');
    const member = state.members.find((m) => m.playerId === all[3]);
    expect(member).toBeDefined();
    expect(member!.connected).toBe(false);
  });
});
