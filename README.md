# ♟ Hand & Brain Chess

An interactive implementation of **Hand and Brain**, the team chess variant.

Each side is two players:

- The **Brain** names a *piece type* (pawn, knight, bishop, rook, queen, king).
- The **Hand** must move a piece of that type — choosing *which* one and *where*,
  among all legal moves of that type.

The Brain communicates **only** the piece type. That single-bit-per-turn
constraint is the whole point of the game, and it is preserved everywhere.

## Status

**Phase 1 — Stockfish AI (opponent and teammate).** Four playable modes:

- **Hot-seat** — all four roles played by humans passing the device (Phase 0).
- **You vs AI** — you play both Brain and Hand against a Stockfish team.
- **AI Brain teammate** — Stockfish announces a piece type; you choose which
  piece and where. Diverging from its exact idea is the fun.
- **AI Hand teammate** — you name the piece type; Stockfish plays the best
  move of that type.

Full chess rules (castling, en passant, promotion, check, checkmate,
stalemate, draws) are correct because rule logic is delegated entirely to
[chess.js](https://github.com/jhlywa/chess.js).

Planned next: Phase 2 (online multiplayer with an authoritative server),
Phase 3 (dual Hand/Brain Elo + history). See the build brief for details.

## Architecture

> **chess.js is the single source of truth** for move generation, legality, and
> game-over detection. The Hand and Brain logic is a thin, well-tested layer on
> top of it — it never reimplements chess rules.

### The turn protocol

The engine implements exactly this ordering, which makes every edge case fall
out for free:

1. Compute **all legal moves** for the side to move (chess.js).
2. Derive the set of piece types that have ≥ 1 legal move.
3. The **Brain** picks one type from that set (membership is validated).
4. Filter legal moves to that piece type; present them to the Hand.
5. The **Hand** picks one move from the filtered set (validated).
6. Apply the move, switch sides.

Because the offered types are *derived from the legal-move list*:

- **Check** needs no special-casing — types that can't resolve the check simply
  never appear as Brain options.
- **Castling** is a king move, **en passant** and **promotion** are pawn moves
  (promotion additionally lets the Hand choose the promotion piece).
- The Brain can never name a type that has no legal move.

### The seat model (AI integration)

Every game has four seats — a Brain and a Hand per color — and each seat is
controlled by a human or by the AI. All game modes are just seat
configurations, driven by one orchestrator:

- **AI Brain** runs a full Stockfish search, then announces only the piece
  *type* of its preferred move — exactly the one bit a human Brain may
  communicate.
- **AI Hand** obeys the named type mechanically: the search is restricted with
  UCI `searchmoves` to the legal moves of that type, so the engine cannot
  "cheat" outside the Brain's instruction.

Stockfish runs in-browser as a single-threaded WASM Web Worker (the
`lite-single` build: ~7&nbsp;MB, no cross-origin-isolation headers needed, far
stronger than any human). Difficulty (1–8) maps to Stockfish's Skill Level
plus a per-move time budget; the mapping lives in one table
(`src/ai/uci.ts`) so it is easy to retune. The engine binary is **not**
committed — `scripts/copy-stockfish.mjs` stages it from `node_modules` into
`public/engine/` on install and before dev/build.

### Layout

```
src/
  engine/                Framework-agnostic Hand & Brain protocol over chess.js
    types.ts             Shared types (PieceType, Phase, GameSnapshot, …)
    HandBrainGame.ts     The turn protocol — the heart of the project
    HandBrainGame.test.ts Protocol + edge-case tests (vitest)
  ai/                    Stockfish integration
    uci.ts               Pure UCI helpers + difficulty mapping (unit-tested)
    StockfishEngine.ts   Async wrapper around the WASM Web Worker
    position.ts          Piece-type lookup for Brain announcements
    integration.test.ts  Real-engine test of the full protocol loop
  game/
    seats.ts             Seat model, mode presets, turn-actor logic
  ui/                    React interface
    useHandBrainGame.ts  React binding for the engine
    useAiSeats.ts        Drives AI-controlled seats
    App.tsx              Setup ⇄ game flow, board, panels
    GameSetup.tsx, BrainPanel.tsx, HandPanel.tsx, PromotionPicker.tsx, …
  main.tsx
scripts/
  copy-stockfish.mjs     Stages the engine WASM into public/engine/
```

The engine layer has no React or DOM dependency, so the same protocol layer
will back the future online-server phase.

## Getting started

Requires Node 18+.

```bash
npm install
npm run dev        # start the local hot-seat app (Vite dev server)
npm test           # run the engine/protocol test suite
npm run build      # type-check and produce a production build
```

Open the dev-server URL it prints (default http://localhost:5173).

## How to play

Pick a mode, color, and difficulty on the setup screen, then on each turn:

1. **Brain:** click one of the offered piece types (or wait for the AI Brain's
   announcement).
2. **Hand:** the board highlights every movable piece of that type. Click a
   piece, then a highlighted destination (or drag it, or pick from the move
   list). Promotions prompt for the promotion piece. Use *Back to Brain* to
   reconsider before moving (only when your Brain is human — you can't ask an
   AI Brain to re-decide).

In hot-seat the board orients toward the side to move; with AI in the game it
stays on your team's side. The banner shows whose turn it is, which role must
act, and check / game-over state.

## Tech

- **Rules:** [chess.js](https://github.com/jhlywa/chess.js) (authoritative)
- **AI:** [Stockfish.js](https://github.com/nmrugg/stockfish.js) WASM
  (GPLv3, loaded as a separate runtime worker asset, not bundled)
- **UI:** React + TypeScript, [react-chessboard](https://github.com/Clariity/react-chessboard)
- **Build/test:** Vite + Vitest

## License

[MIT](MIT.md)
