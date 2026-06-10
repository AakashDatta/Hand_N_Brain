/**
 * Network wiring: an HTTP server (optionally serving the built web app) with
 * the authoritative game WebSocket attached at /ws.
 *
 * This layer is intentionally thin: it parses/validates frames with
 * parseClientMessage and routes them to the Lobby. All game logic and all
 * trust decisions live in Lobby/Match, which never see a socket.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '@hnb/core';
import { Lobby, type LobbyOptions } from './lobby';

export interface GameServer {
  port: number;
  close(): Promise<void>;
}

export interface GameServerOptions extends LobbyOptions {
  port?: number;
  /** Directory of the built web app to serve statically (optional). */
  staticDir?: string;
}

export function startServer(options: GameServerOptions = {}): Promise<GameServer> {
  const httpServer = createServer((req, res) =>
    serveStatic(req, res, options.staticDir),
  );
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // One socket per player id; replaced wholesale on reconnect.
  const sockets = new Map<string, WebSocket>();

  const lobby = new Lobby(
    {
      send(playerId: string, message: ServerMessage) {
        const socket = sockets.get(playerId);
        if (socket && socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    },
    options,
  );

  wss.on('connection', (socket) => {
    let playerId: string | null = null;

    socket.on('message', (data) => {
      const message = parseClientMessage(data.toString());
      if (!message) {
        socket.send(
          JSON.stringify({
            type: 'error-message',
            code: 'bad-message',
            message: 'Malformed message.',
          } satisfies ServerMessage),
        );
        return;
      }

      // The first valid message must be hello; it binds the socket to a
      // player identity. Everything else routes through the lobby.
      if (message.type === 'hello') {
        if (playerId !== null) return; // ignore duplicate hellos
        // The socket must be routable before the lobby sends the welcome.
        playerId = lobby.hello(message.token, message.name, (id) => {
          sockets.set(id, socket);
        });
        return;
      }
      if (playerId === null) {
        socket.send(
          JSON.stringify({
            type: 'error-message',
            code: 'bad-message',
            message: 'Say hello first.',
          } satisfies ServerMessage),
        );
        return;
      }
      lobby.handleMessage(playerId, message);
    });

    socket.on('close', () => {
      if (playerId !== null && sockets.get(playerId) === socket) {
        sockets.delete(playerId);
        lobby.disconnect(playerId);
      }
    });
  });

  return new Promise((resolvePromise) => {
    httpServer.listen(options.port ?? 0, () => {
      const address = httpServer.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolvePromise({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => httpServer.close(() => done()));
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Minimal static file serving (production single-deployable convenience)
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir?: string,
): void {
  if (!staticDir || !req.url) {
    res.writeHead(404).end();
    return;
  }
  const root = resolve(staticDir);
  const urlPath = req.url.split('?')[0];
  const requested = normalize(join(root, urlPath === '/' ? 'index.html' : urlPath));
  // Containment check: never serve outside the static root.
  const target = requested.startsWith(root) ? requested : null;

  // SPA fallback: unknown paths get index.html.
  const file =
    target && existsSync(target) && statSync(target).isFile()
      ? target
      : join(root, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
}
