/** `POST /api/reindex { full?: boolean }` */
import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';
import { reindexBodySchema } from '../schemas.js';
import { badRequest } from '../errors.js';

export function reindexRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  app.post('/', async (c) => {
    // A genuinely bodyless POST (curl -X POST with nothing after it, or the web client's
    // fire-and-forget "reindex" button) must not 400 on `c.req.json()`'s "Unexpected end of
    // JSON input" — but gating that on the `content-length` header (the previous approach) is
    // unreliable: a request sent with `Transfer-Encoding: chunked` and no `Content-Length` at
    // all is valid HTTP and would silently be read as bodyless, downgrading `{full:true}` to a
    // plain rescan without ever telling the caller. Reading the raw text once and branching on
    // whether it's empty works regardless of how the body was framed.
    const raw = await c.req.text();
    let full: { full?: boolean };
    if (raw.trim().length === 0) {
      full = { full: false };
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return badRequest(c, 'request body must be valid JSON');
      }
      const result = reindexBodySchema.safeParse(parsed);
      if (!result.success) return badRequest(c, 'invalid request body field(s): full');
      full = result.data;
    }
    if (full.full) {
      deps.index.requestFull();
    } else {
      deps.index.requestRescan();
    }
    return c.json({ started: true });
  });
  return app;
}
