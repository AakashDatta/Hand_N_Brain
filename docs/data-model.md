# Data model

Defined ahead of the online phase (Phase 2) so the in-memory server objects
mirror what will be persisted in Postgres (via Prisma) in Phase 3. Phase 2
keeps everything in server memory; Phase 3 adds the database without changing
the shapes.

## Entities

### users

| column        | type        | notes                                        |
| ------------- | ----------- | -------------------------------------------- |
| id            | uuid PK     |                                              |
| email         | text unique | null for anonymous/guest accounts            |
| display_name  | text        | shown in lobbies and match history           |
| created_at    | timestamptz |                                              |

Phase 2 uses anonymous players only: a server-issued session token maps to a
transient player identity (`players.token` below). Phase 3 introduces real
accounts (email + OAuth) and lets a guest identity be claimed by an account.

### ratings

Each user has **two independent ratings**, one per role. Stored as rows
rather than columns so per-role metadata (game count, provisional status)
stays normalized.

| column      | type                      | notes                              |
| ----------- | ------------------------- | ---------------------------------- |
| user_id     | uuid FK -> users          |                                    |
| role        | enum('hand','brain')      |                                    |
| rating      | int, default 1200         | floored at 100                     |
| games_count | int, default 0            | drives the provisional K-factor    |
| updated_at  | timestamptz               |                                    |

PK: (user_id, role).

Rating math (Phase 3, isolated in `@hnb/core` so it is easy to retune):
seed 1200; K=40 for a role's first 20 games, then K=32; floor 100. Each
player's role rating updates against the **opposing team's average relevant
rating** with the team result S (1 / 0.5 / 0):
`E = 1 / (1 + 10^((R_opp − R_self)/400))`, `R' = R + K·(S − E)`.
The opponent-rating definition is an explicitly tunable design choice.

### games

| column        | type        | notes                                          |
| ------------- | ----------- | ---------------------------------------------- |
| id            | uuid PK     |                                                |
| started_at    | timestamptz |                                                |
| ended_at      | timestamptz | null while in progress                         |
| initial_fen   | text        | standard start unless a variant position       |
| result        | enum        | 'white' \| 'black' \| 'draw' \| 'aborted'      |
| end_reason    | enum        | checkmate, stalemate, repetition, fifty-move, insufficient material, resignation, abandonment |
| rated         | boolean     |                                                |

### game_players

One row per occupied seat (4 rows per 2v2 game; AI seats reference no user).

| column      | type                  | notes                                   |
| ----------- | --------------------- | --------------------------------------- |
| game_id     | uuid FK -> games      |                                         |
| user_id     | uuid FK -> users      | null for an AI seat                     |
| color       | enum('w','b')         |                                         |
| role        | enum('hand','brain')  |                                         |
| rating_before | int                 | snapshot for history/leaderboard deltas |
| rating_after  | int                 | null until the game is rated            |

PK: (game_id, color, role).

### moves

The full Hand-and-Brain record: each half-move stores both the Brain's
announcement and the Hand's chosen move, which is what makes replays of this
variant interesting (you can see where the Hand diverged from the obvious
choice).

| column        | type             | notes                                  |
| ------------- | ---------------- | -------------------------------------- |
| game_id       | uuid FK -> games |                                        |
| ply           | int              | 1-based half-move index                |
| color         | enum('w','b')    |                                        |
| brain_choice  | enum piece type  | what the Brain announced               |
| san           | text             | the move the Hand played               |
| fen_after     | text             | position after the move (replay/resume) |
| played_at     | timestamptz      |                                        |

PK: (game_id, ply).

## Phase 2 in-memory counterparts

| persistent (Phase 3) | in-memory (Phase 2)                                  |
| -------------------- | ---------------------------------------------------- |
| users + session      | `Player { id, token, name, socket }`                 |
| games + game_players | `Match { id, seats, game: HandBrainGame, outcome }`  |
| moves                | `HandBrainGame` history (SAN) inside the match       |

The matchmaking queue is transient in both phases and is never persisted.
