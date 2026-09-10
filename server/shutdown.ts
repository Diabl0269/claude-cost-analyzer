/**
 * Builds the `close()` used by `RunningServer` (see `server/index.ts`). Pulled out on its own
 * so it can be unit-tested against fakes — no real `listen()`, no real worker thread, no real
 * DB — while `startServer` wires it up against the real `http.Server`/`Store`/`IndexManagerLike`
 * /`Watcher`/`SseHub`.
 *
 * Order matters: stop producing new work (watcher, indexer) and end every open SSE stream on our
 * own terms first — otherwise `server.close()` waits forever on a connection that never ends by
 * itself (an SSE stream the client never closes). Only once every connection is actually gone do
 * we close the store; closing it any earlier races an in-flight (or forcibly-aborted) request
 * still reading from it and turns a clean shutdown into an "unhandled error in request handler"
 * for that request.
 */
export interface CloseableServer {
  close(callback: (err?: Error) => void): void;
  /** Optional: absent on the `Http2Server` half of `@hono/node-server`'s `ServerType` union,
   * always present on the plain `http.Server` this app actually gets back from `serve()`. */
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownDeps {
  watcher: { dispose(): void };
  index: { dispose(): Promise<void> };
  sse: { closeAll(): Promise<void> };
  store: { close(): void };
  server: CloseableServer;
}

export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
  const { watcher, index, sse, store, server } = deps;
  return async function close(): Promise<void> {
    watcher.dispose();
    await index.dispose();
    await sse.closeAll();

    const closed = new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    // Every SSE stream just ended itself above, so anything `server.close()` is still waiting on
    // here is an idle keep-alive socket or a genuinely stuck connection — force both closed
    // rather than let either hang the process.
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await closed;

    store.close();
  };
}
