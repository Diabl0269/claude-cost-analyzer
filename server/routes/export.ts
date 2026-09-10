/** `GET /api/export/sessions.csv`, `GET /api/export/sessions/:id.json` */
import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';
import { queryContext } from '../deps.js';
import { sessionIdTokenSchema, sessionsQuerySchema, whatIfQuerySchema } from '../schemas.js';
import { parseQuery } from '../validate.js';
import { badRequest, notFound } from '../errors.js';

export function exportRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/sessions.csv', async (c) => {
    const query = parseQuery(c, sessionsQuerySchema);
    if (!query.ok) return query.response;
    const csv = await deps.store.exportSessionsCsv(query.data, queryContext(deps.config));
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="sessions.csv"');
    return c.body(csv);
  });

  app.get('/sessions/:idJson', async (c) => {
    const raw = c.req.param('idJson');
    if (!raw.endsWith('.json')) return badRequest(c, 'expected a path ending in .json');
    const id = raw.slice(0, -'.json'.length);
    if (id.length === 0) return badRequest(c, 'missing session id');
    const idCheck = sessionIdTokenSchema.safeParse(id);
    if (!idCheck.success) return badRequest(c, 'invalid session id');
    const query = parseQuery(c, whatIfQuerySchema);
    if (!query.ok) return query.response;
    const result = await deps.store.exportSession(id, queryContext(deps.config, query.data.whatIf));
    if (!result) return notFound(c, 'no session with that id');
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${id}.json"`);
    return c.json(result);
  });

  return app;
}
