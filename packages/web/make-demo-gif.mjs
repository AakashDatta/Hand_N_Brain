/**
 * Renders a REAL Hand & Brain game (actual @hnb/core engine + Stockfish on
 * both sides) to an animated GIF: each frame shows the board after a move,
 * with a caption naming the Brain's piece type and the Hand's actual move.
 * No browser involved — SVG is rasterized with @resvg/resvg-wasm and frames
 * are encoded with gifenc.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import { HandBrainGame, PIECE_TYPE_NAMES } from '@hnb/core';
import {
  buildGoCommand,
  difficultySettings,
  legalMoveToUci,
  parseBestMoveLine,
} from './src/ai/uci.ts';
import { pieceTypeAtSquare } from './src/ai/position.ts';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const require = createRequire(import.meta.url);

// ---- rendering ----------------------------------------------------------
const SQ = 56;
const MARGIN = 18;
const CAPTION_H = 64;
const BOARD = SQ * 8;
const W = BOARD + MARGIN * 2;
const H = BOARD + MARGIN * 2 + CAPTION_H;

const LIGHT = '#eceed1';
const DARK = '#7a9b56';
const LASTMOVE = 'rgba(255, 213, 79, 0.55)';
const CHECK = 'rgba(214, 48, 49, 0.65)';

const GLYPH = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** Build an SVG of the position (white at bottom) with a caption. */
function boardSvg(fen, caption, lastMove, inCheckSquare) {
  const board = new Chess(fen).board(); // rank 8 first
  let cells = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const x = MARGIN + f * SQ;
      const y = MARGIN + r * SQ;
      const square = `${'abcdefgh'[f]}${8 - r}`;
      const light = (r + f) % 2 === 0;
      cells += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${light ? LIGHT : DARK}"/>`;
      if (lastMove && (square === lastMove.from || square === lastMove.to)) {
        cells += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${LASTMOVE}"/>`;
      }
      if (square === inCheckSquare) {
        cells += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${CHECK}"/>`;
      }
      const piece = board[r][f];
      if (piece) {
        const glyph = GLYPH[`${piece.color}${piece.type}`];
        const cx = x + SQ / 2;
        const cy = y + SQ / 2;
        // White pieces: white fill, dark outline; black pieces: dark fill.
        const fill = piece.color === 'w' ? '#ffffff' : '#1b1b1b';
        const stroke = piece.color === 'w' ? '#1b1b1b' : '#000000';
        cells += `<text x="${cx}" y="${cy}" font-family="DejaVu Sans" font-size="${SQ * 0.82}" text-anchor="middle" dominant-baseline="central" fill="${fill}" stroke="${stroke}" stroke-width="1.1">${glyph}</text>`;
      }
    }
  }
  const capY = MARGIN * 2 + BOARD;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#1f2430"/>
    ${cells}
    <rect x="0" y="${capY}" width="${W}" height="${CAPTION_H}" fill="#1f2430"/>
    <text x="${W / 2}" y="${capY + 26}" font-family="DejaVu Sans" font-size="18" font-weight="bold" text-anchor="middle" fill="#e8eaf0">${esc(caption.line1)}</text>
    <text x="${W / 2}" y="${capY + 50}" font-family="DejaVu Sans" font-size="15" text-anchor="middle" fill="#9aa3b8">${esc(caption.line2)}</text>
  </svg>`;
}

function kingSquare(fen, color) {
  const board = new Chess(fen).board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === 'k' && p.color === color) return `${'abcdefgh'[f]}${8 - r}`;
  }
  return null;
}

// ---- engine -------------------------------------------------------------
const engine = await require('stockfish')('lite-single');
let pending = null;
engine.listener = (line) => { if (pending && pending.test(line)) { const r = pending; pending = null; r.resolve(line); } };
const send = (c) => engine.sendCommand(c);
const waitFor = (re) => new Promise((resolve) => { pending = { test: (l) => re.test(l), resolve }; });
async function bestMove(fen, difficulty, searchMoves) {
  const { skillLevel, movetimeMs } = difficultySettings(difficulty);
  send(`setoption name Skill Level value ${skillLevel}`);
  send(`position fen ${fen}`);
  send(buildGoCommand(movetimeMs, searchMoves));
  return parseBestMoveLine(await waitFor(/^bestmove/));
}

// ---- main ---------------------------------------------------------------
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const fontBuffer = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');

function rasterize(svg) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontBuffers: [fontBuffer], defaultFontFamily: 'DejaVu Sans' },
  });
  const png = r.render();
  return { data: png.pixels, width: png.width, height: png.height };
}

const gif = new GIFEncoder();
function addFrame(svg, delayMs) {
  const { data, width, height } = rasterize(svg);
  const rgba = new Uint8Array(data);
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, width, height, { palette, delay: delayMs });
}

send('uci'); await waitFor(/^uciok/);
send('isready'); await waitFor(/^readyok/);

const game = new HandBrainGame();
const difficulty = 4;
const MAX_PLIES = Number(process.argv[2] ?? 24);

// Title frame.
addFrame(boardSvg(game.fen, { line1: 'Hand & Brain — Stockfish vs Stockfish', line2: 'Brain names a piece TYPE · Hand moves that type' }, null, null), 1400);

let lastMove = null;
while (!game.isGameOver() && game.snapshot().history.length < MAX_PLIES) {
  const side = game.turn === 'w' ? 'White' : 'Black';
  const brainPref = await bestMove(game.fen, difficulty);
  const announced = pieceTypeAtSquare(game.fen, brainPref.from);
  game.selectPieceType(announced);

  const allowed = game.handMoves();
  const choice = await bestMove(game.fen, difficulty, allowed.map(legalMoveToUci));
  const picked = allowed.find((m) => m.from === choice.from && m.to === choice.to && m.promotion === choice.promotion);
  const san = game.selectMove(picked);
  lastMove = { from: picked.from, to: picked.to };

  const moveNo = Math.ceil(game.snapshot().history.length / 2);
  const diverged = brainPref.from !== picked.from || brainPref.to !== picked.to;
  const check = game.snapshot().inCheck ? kingSquare(game.fen, game.turn) : null;
  addFrame(
    boardSvg(
      game.fen,
      {
        line1: `${moveNo}. ${side} Brain: "${PIECE_TYPE_NAMES[announced]}"  →  Hand plays ${san}`,
        line2: diverged ? 'Hand diverged from the engine’s top move' : 'Hand played the engine’s top move',
      },
      lastMove,
      check,
    ),
    1100,
  );
  process.stdout.write('.');
}

// Hold the final frame.
const result = game.result();
const finalLine = result
  ? (result.winner ? `${result.winner === 'w' ? 'White' : 'Black'} wins — ${result.reason}` : `Draw — ${result.reason}`)
  : 'Game in progress';
addFrame(boardSvg(game.fen, { line1: finalLine, line2: `${game.snapshot().history.length} half-moves played` }, lastMove, null), 2600);

gif.finish();
const outPath = new URL('../../docs/hand-brain-demo.gif', import.meta.url);
writeFileSync(outPath, Buffer.from(gif.bytes()));
console.log('\nWrote docs/hand-brain-demo.gif');
process.exit(0);
