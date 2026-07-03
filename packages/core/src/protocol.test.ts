import { describe, expect, it } from 'vitest';
import { parseClientMessage, sanitizeName } from './protocol';

describe('parseClientMessage', () => {
  it('parses valid messages from JSON strings and objects', () => {
    expect(parseClientMessage('{"type":"queue-leave"}')).toEqual({
      type: 'queue-leave',
    });
    expect(parseClientMessage({ type: 'queue-join', role: 'brain' })).toEqual({
      type: 'queue-join',
      role: 'brain',
    });
  });

  it('parses hello with optional token and name', () => {
    expect(parseClientMessage({ type: 'hello' })).toEqual({ type: 'hello' });
    expect(
      parseClientMessage({ type: 'hello', token: 'abc', name: '  Kasparov  ' }),
    ).toEqual({ type: 'hello', token: 'abc', name: 'Kasparov' });
  });

  it('parses select-piece-type and rejects unknown piece types', () => {
    expect(
      parseClientMessage({ type: 'select-piece-type', matchId: 'm1', pieceType: 'n' }),
    ).toEqual({ type: 'select-piece-type', matchId: 'm1', pieceType: 'n' });
    expect(
      parseClientMessage({ type: 'select-piece-type', matchId: 'm1', pieceType: 'x' }),
    ).toBeNull();
    expect(
      parseClientMessage({ type: 'select-piece-type', pieceType: 'n' }),
    ).toBeNull();
  });

  it('parses select-move with and without promotion', () => {
    expect(
      parseClientMessage({ type: 'select-move', matchId: 'm1', from: 'e2', to: 'e4' }),
    ).toEqual({ type: 'select-move', matchId: 'm1', from: 'e2', to: 'e4' });
    expect(
      parseClientMessage({
        type: 'select-move',
        matchId: 'm1',
        from: 'a7',
        to: 'a8',
        promotion: 'q',
      }),
    ).toEqual({
      type: 'select-move',
      matchId: 'm1',
      from: 'a7',
      to: 'a8',
      promotion: 'q',
    });
  });

  it('rejects malformed squares, promotions, and shapes', () => {
    expect(
      parseClientMessage({ type: 'select-move', matchId: 'm1', from: 'e9', to: 'e4' }),
    ).toBeNull();
    expect(
      parseClientMessage({ type: 'select-move', matchId: 'm1', from: 'e2', to: 'e4', promotion: 'k' }),
    ).toBeNull();
    expect(parseClientMessage({ type: 'queue-join', role: 'spectator' })).toBeNull();
    expect(parseClientMessage('not json at all')).toBeNull();
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage([1, 2, 3])).toBeNull();
    expect(parseClientMessage({ type: 'launch-missiles' })).toBeNull();
  });
});

describe('sanitizeName', () => {
  it('trims and bounds names', () => {
    expect(sanitizeName('  Anand ')).toBe('Anand');
    expect(sanitizeName('x'.repeat(100))!.length).toBe(32);
  });

  it('rejects empty and non-string names', () => {
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
  });
});
