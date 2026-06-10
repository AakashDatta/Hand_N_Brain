/**
 * In-memory match history (Phase 3 seam for the `games`/`game_players`
 * tables in docs/data-model.md). Bounded so a long-lived process does not
 * grow without limit; the database implementation removes the bound.
 */
import type {
  MatchHistoryEntry,
  MatchOutcome,
  SeatAssignment,
} from '@hnb/core';

export interface MatchRecord {
  matchId: string;
  endedAt: number;
  players: { playerId: string; name: string; seat: SeatAssignment }[];
  outcome: MatchOutcome;
  moveCount: number;
}

const MAX_RECORDS = 1000;

export class MatchLog {
  private records: MatchRecord[] = [];

  add(record: MatchRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
  }

  /** A player's most recent finished matches, newest first. */
  forPlayer(playerId: string, limit = 20): MatchHistoryEntry[] {
    const entries: MatchHistoryEntry[] = [];
    for (let i = this.records.length - 1; i >= 0 && entries.length < limit; i--) {
      const record = this.records[i];
      const me = record.players.find((p) => p.playerId === playerId);
      if (!me) continue;

      const teammate = record.players.find(
        (p) => p.seat.color === me.seat.color && p.playerId !== playerId,
      );
      const opponents = record.players.filter(
        (p) => p.seat.color !== me.seat.color,
      );
      entries.push({
        matchId: record.matchId,
        endedAt: record.endedAt,
        seat: me.seat,
        outcome: record.outcome,
        teammate: teammate?.name ?? '',
        opponents: opponents.map((p) => p.name),
        moveCount: record.moveCount,
      });
    }
    return entries;
  }
}
