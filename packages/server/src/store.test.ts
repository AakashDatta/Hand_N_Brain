import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialRating } from '@hnb/core';
import { JsonFileStore, type PersistedState } from './store';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hnb-store-'));
  file = join(dir, 'state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sample: PersistedState = {
  version: 1,
  players: [
    {
      id: 'p1',
      token: 't1',
      name: 'Ada',
      ratings: { hand: { rating: 1240, gamesPlayed: 3 }, brain: initialRating() },
    },
  ],
  matches: [],
};

describe('JsonFileStore', () => {
  it('returns null before anything is saved', () => {
    expect(new JsonFileStore(file).load()).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const store = new JsonFileStore(file);
    store.save(sample);
    expect(store.load()).toEqual(sample);
  });

  it('creates missing parent directories', () => {
    const nested = join(dir, 'a', 'b', 'state.json');
    const store = new JsonFileStore(nested);
    store.save(sample);
    expect(store.load()).toEqual(sample);
  });

  it('overwrites prior state atomically (no leftover temp on read)', () => {
    const store = new JsonFileStore(file);
    store.save(sample);
    const updated: PersistedState = { ...sample, players: [] };
    store.save(updated);
    expect(store.load()).toEqual(updated);
  });

  it('ignores invalid JSON instead of throwing', () => {
    writeFileSync(file, '{ not json');
    expect(new JsonFileStore(file).load()).toBeNull();
  });

  it('ignores an unexpected shape / version', () => {
    writeFileSync(file, JSON.stringify({ version: 99, players: [] }));
    expect(new JsonFileStore(file).load()).toBeNull();
  });
});
