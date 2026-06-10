/**
 * Durable storage seam for the lobby.
 *
 * The lobby keeps everything in memory for speed; this seam lets that state
 * survive process restarts. The default implementation is a single JSON file
 * (atomic writes, no external service — works on any host with a disk). The
 * Postgres/Prisma store described in docs/data-model.md becomes a drop-in
 * `Store` implementation later, without touching the lobby.
 *
 * Only durable facts are persisted: player identities + their two ratings,
 * and finished-match history. Transient state — live matches, the queue,
 * socket connections — is intentionally NOT persisted; a restart drops
 * in-progress games, which the reconnection/abandonment logic already treats
 * as the players having left.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { PlayerRatings } from '@hnb/core';
import type { MatchRecord } from './history';

export interface PersistedPlayer {
  id: string;
  token: string;
  name: string;
  ratings: PlayerRatings;
}

export interface PersistedState {
  version: 1;
  players: PersistedPlayer[];
  matches: MatchRecord[];
}

export interface Store {
  /** Load saved state, or null if nothing has been persisted yet. */
  load(): PersistedState | null;
  /** Persist a full snapshot. Implementations should write atomically. */
  save(state: PersistedState): void;
}

const CURRENT_VERSION = 1 as const;

/**
 * A JSON-file store. Writes go to a temp file that is atomically renamed over
 * the target, so a crash mid-write can never corrupt the saved state.
 */
export class JsonFileStore implements Store {
  constructor(private readonly filePath: string) {}

  load(): PersistedState | null {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return null; // No file yet — first run.
    }
    try {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.players)) {
        console.warn(`Store: ignoring ${this.filePath} (unexpected shape).`);
        return null;
      }
      return parsed;
    } catch {
      console.warn(`Store: ignoring ${this.filePath} (invalid JSON).`);
      return null;
    }
  }

  save(state: PersistedState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const json = JSON.stringify(state, null, 2);
    // Write fully and fsync before renaming so the swap is all-or-nothing.
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, json);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }
}
