import type { ClientMessage, ServerMessage } from '@hnb/core';

/**
 * WebSocket client for the game server.
 *
 * Handles the hello handshake (presenting any persisted session token so the
 * server re-attaches our identity and active match) and automatic reconnects
 * with capped exponential backoff. Inbound messages are forwarded to a single
 * listener; the hook layer owns all state.
 */

const TOKEN_STORAGE_KEY = 'hnb-session-token';

/** Where the server lives: same origin as the page (Vite proxies /ws in dev). */
export function defaultServerUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws`;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export class GameSocket {
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  onMessage: ((message: ServerMessage) => void) | null = null;
  onStatus: ((status: ConnectionStatus) => void) | null = null;

  constructor(
    private readonly url: string = defaultServerUrl(),
    private name: string | undefined = undefined,
  ) {}

  connect(): void {
    if (this.disposed) return;
    this.onStatus?.('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.send({
        type: 'hello',
        token: localStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined,
        name: this.name,
      });
      this.onStatus?.('open');
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        localStorage.setItem(TOKEN_STORAGE_KEY, message.token);
      }
      this.onMessage?.(message);
    };

    socket.onclose = () => {
      this.onStatus?.('closed');
      this.scheduleReconnect();
    };
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  setName(name: string): void {
    this.name = name;
    this.send({ type: 'set-name', name });
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    // 0.5s, 1s, 2s, 4s, 8s, then every 10s.
    const delay = Math.min(500 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
