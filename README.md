# ♟ Hand & Brain Chess

An interactive implementation of **Hand and Brain**, the team chess variant.

Each side is two players:

- The **Brain** names a *piece type* (pawn, knight, bishop, rook, queen, king).
- The **Hand** must move a piece of that type — choosing *which* one and *where*,
  among all legal moves of that type.

The Brain communicates **only** the piece type. That single-bit-per-turn
constraint is the whole point of the game, and it is preserved everywhere.

## Status

**Phase 0 — core engine + local hot-seat.** Playable locally with all roles on
one machine. Full chess rules (castling, en passant, promotion, check,
checkmate, stalemate, draws) are correct because rule logic is delegated
entirely to [chess.js](https://github.com/jhlywa/chess.js).

Planned next: Phase 1 (Stockfish AI opponent / AI teammate), Phase 2 (online
multiplayer with an authoritative server), Phase 3 (dual Hand/Brain Elo +
history). See the build brief for details.

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

### Layout

```
src/
  engine/                Framework-agnostic Hand & Brain protocol over chess.js
    types.ts             Shared types (PieceType, Phase, GameSnapshot, …)
    HandBrainGame.ts     The turn protocol — the heart of the project
    HandBrainGame.test.ts Protocol + edge-case tests (vitest)
    index.ts
  ui/                    React hot-seat interface
    useHandBrainGame.ts  React binding for the engine
    App.tsx              Board + Brain/Hand panels + history
    BrainPanel.tsx, HandPanel.tsx, PromotionPicker.tsx, …
  main.tsx
```

The engine has no React or DOM dependency, so the same protocol layer will back
the future Stockfish and online-server phases.

## Getting started

Requires Node 18+.

```bash
npm install
npm run dev        # start the local hot-seat app (Vite dev server)
npm test           # run the engine/protocol test suite
npm run build      # type-check and produce a production build
```

Open the dev-server URL it prints (default http://localhost:5173).

## How to play (hot-seat)

The board orients toward the side to move. On each turn:

1. **Brain:** click one of the offered piece types.
2. **Hand:** the board highlights every movable piece of that type. Click a
   piece, then a highlighted destination (or drag it, or pick from the move
   list). Promotions prompt for the promotion piece. Use *Back to Brain* to
   reconsider before moving.

The banner shows whose turn it is, which role must act, and check / game-over
state.

## Tech

- **Rules:** [chess.js](https://github.com/jhlywa/chess.js) (authoritative)
- **UI:** React + TypeScript, [react-chessboard](https://github.com/Clariity/react-chessboard)
- **Build/test:** Vite + Vitest

## License

[MIT](MIT.md)
