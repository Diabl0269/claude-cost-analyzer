/**
 * Server-Sent Events hub for `GET /api/events`. Broadcasts `IndexEvent`s (indexing progress,
 * "sessions changed" notices) to every connected browser tab. Each client gets a 15s ping so
 * intermediaries don't time out the connection; disconnects are cleaned up automatically.
 *
 * Shutdown: `closeAll()` ends every open stream itself (writes a `bye` frame, then closes the
 * writer) instead of leaving the HTTP server to wait on — or forcibly destroy — those sockets.
 * `stream.write`/`writeSSE` already swallow their own errors (see `hono/utils/stream`), so a
 * client that disconnects mid-write, or one we're closing during shutdown, never throws back
 * into the request handler.
 */
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { IndexEvent } from '../core/types.js';

const PING_INTERVAL_MS = 15_000;

type Client = (event: IndexEvent) => Promise<void>;

interface ClientEntry {
  send: Client;
  /** Ends this client's stream cleanly; used only by `closeAll()` during shutdown. */
  closeCleanly: () => Promise<void>;
}

export interface SseHub {
  /** Hono handler for `GET /api/events`. */
  handler: (c: Context) => Response;
  /** Sends an event to every currently connected client. */
  broadcast(event: IndexEvent): void;
  /** Number of currently connected clients (for tests). */
  clientCount(): number;
  /**
   * Ends every connected client stream: writes a final `bye` frame, then closes the writer, so
   * the underlying HTTP connection finishes on its own instead of the server having to wait for
   * (or forcibly cut) an SSE connection that would otherwise stay open forever. Safe to call
   * with zero clients; never throws.
   */
  closeAll(): Promise<void>;
}

export function createSseHub(): SseHub {
  const clients = new Set<ClientEntry>();

  return {
    clientCount: () => clients.size,
    broadcast(event: IndexEvent) {
      for (const { send } of clients) {
        void send(event).catch(() => {
          // the client will be removed by its own onAbort handler
        });
      }
    },
    async closeAll(): Promise<void> {
      const entries = [...clients];
      clients.clear();
      await Promise.all(
        entries.map((entry) =>
          entry.closeCleanly().catch(() => {
            // best-effort: shutdown proceeds regardless of a single client failing to close
          }),
        ),
      );
    },
    handler: (c: Context) =>
      streamSSE(c, async (stream) => {
        const send: Client = async (event) => {
          await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
        };
        const entry: ClientEntry = {
          send,
          closeCleanly: async () => {
            clearInterval(ping);
            await stream.writeSSE({ event: 'bye', data: '' }).catch(() => {});
            await stream.close();
          },
        };
        clients.add(entry);

        const ping = setInterval(() => {
          void send({ type: 'ping' }).catch(() => {});
        }, PING_INTERVAL_MS);

        stream.onAbort(() => {
          clearInterval(ping);
          clients.delete(entry);
        });

        // Keep the handler alive until the connection closes; writeSSE calls happen from
        // broadcast()/the ping timer/closeCleanly(), all invoked out-of-band from this closure.
        while (!stream.closed) {
          await stream.sleep(PING_INTERVAL_MS);
        }
        clearInterval(ping);
        clients.delete(entry);
      }),
  };
}
