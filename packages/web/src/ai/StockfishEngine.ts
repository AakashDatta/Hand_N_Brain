import {
  buildGoCommand,
  difficultySettings,
  parseBestMoveLine,
  type UciMove,
} from './uci';

/**
 * URL of the Stockfish worker script, staged into public/engine/ by
 * scripts/copy-stockfish.mjs. The script self-bootstraps inside a Web Worker
 * and resolves its sibling .wasm from its own URL.
 */
export const STOCKFISH_WORKER_URL = '/engine/stockfish-18-lite-single.js';

interface SearchRequest {
  fen: string;
  difficulty: number;
  /** Restrict the search to these root moves (the AI-Hand constraint). */
  searchMoves?: UciMove[];
}

/**
 * A thin async wrapper around the Stockfish WASM Web Worker.
 *
 * Searches are serialized through a promise chain: UCI is a stateful,
 * line-oriented protocol, so only one "go" may be in flight at a time. Each
 * search sets the skill level, positions the board by FEN, and waits for the
 * "bestmove" line.
 */
export class StockfishEngine {
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lineListener: ((line: string) => void) | null = null;

  constructor(private readonly workerUrl: string = STOCKFISH_WORKER_URL) {}

  /** Start the worker and complete the UCI handshake. Idempotent. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.start();
    }
    return this.initPromise;
  }

  private async start(): Promise<void> {
    const worker = new Worker(this.workerUrl);
    this.worker = worker;
    worker.onmessage = (event: MessageEvent) => {
      const line = typeof event.data === 'string' ? event.data : '';
      this.lineListener?.(line);
    };

    this.send('uci');
    await this.waitForLine((line) => line === 'uciok');
    this.send('isready');
    await this.waitForLine((line) => line === 'readyok');
  }

  /**
   * Search a position and return the engine's best move. When `searchMoves`
   * is provided the engine may only choose among those moves.
   */
  bestMove(request: SearchRequest): Promise<UciMove> {
    // Chain onto the queue so concurrent callers are serialized.
    const result = this.queue.then(() => this.runSearch(request));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async runSearch(request: SearchRequest): Promise<UciMove> {
    await this.init();
    const { skillLevel, movetimeMs } = difficultySettings(request.difficulty);

    this.send(`setoption name Skill Level value ${skillLevel}`);
    this.send(`position fen ${request.fen}`);
    this.send(buildGoCommand(movetimeMs, request.searchMoves));

    const bestMoveLine = await this.waitForLine(
      (line) => line.startsWith('bestmove'),
    );
    const move = parseBestMoveLine(bestMoveLine);
    if (!move) {
      throw new Error(`Unparseable bestmove line: "${bestMoveLine}"`);
    }
    return move;
  }

  /** Terminate the worker. The engine cannot be reused afterwards. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    this.lineListener = null;
  }

  private send(command: string): void {
    if (!this.worker) {
      throw new Error('StockfishEngine used before init() or after dispose().');
    }
    this.worker.postMessage(command);
  }

  private waitForLine(matches: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      this.lineListener = (line) => {
        if (matches(line)) {
          this.lineListener = null;
          resolve(line);
        }
      };
    });
  }
}
