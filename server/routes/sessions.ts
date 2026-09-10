/** `GET /api/sessions`, `GET /api/sessions/:id`, `/transcript`, `/agents`, `POST /:id/pin` */
import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';
import { queryContext } from '../deps.js';
import {
  sessionIdParamSchema,
  sessionsQuerySchema,
  transcriptQuerySchema,
  whatIfQuerySchema,
} from '../schemas.js';
import { parseParams, parseQuery } from '../validate.js';
import { notFound } from '../errors.js';

export function sessionsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const query = parseQuery(c, sessionsQuerySchema);
    if (!query.ok) return query.response;
    const result = await deps.store.listSessions(query.data, queryContext(deps.config));
    return c.json(result);
  });

  app.get('/:id', async (c) => {
    const params = parseParams(c, sessionIdParamSchema);
    if (!params.ok) return params.response;
    const query = parseQuery(c, whatIfQuerySchema);
    if (!query.ok) return query.response;
    const detail = await deps.store.getSession(params.data.id, queryContext(deps.config, query.data.whatIf));
    if (!detail) return notFound(c, 'no session with that id');
    return c.json(detail);
  });

  app.get('/:id/transcript', async (c) => {
    const params = parseParams(c, sessionIdParamSchema);
    if (!params.ok) return params.response;
    const query = parseQuery(c, transcriptQuerySchema);
    if (!query.ok) return query.response;
    const page = await deps.store.getTranscript(
      params.data.id,
      query.data.agentId ?? null,
      query.data.fromSeq ?? 0,
      query.data.limit ?? 200,
      queryContext(deps.config, query.data.whatIf),
    );
    if (!page) return notFound(c, 'no session with that id');
    return c.json(page);
  });

  app.get('/:id/agents', async (c) => {
    const params = parseParams(c, sessionIdParamSchema);
    if (!params.ok) return params.response;
    const query = parseQuery(c, whatIfQuerySchema);
    if (!query.ok) return query.response;
    const tree = await deps.store.getAgentTree(params.data.id, queryContext(deps.config, query.data.whatIf));
    if (!tree) return notFound(c, 'no session with that id');
    return c.json(tree);
  });

  app.post('/:id/pin', async (c) => {
    const params = parseParams(c, sessionIdParamSchema);
    if (!params.ok) return params.response;
    const existing = await deps.store.getSession(params.data.id, queryContext(deps.config));
    if (!existing) return notFound(c, 'no session with that id');
    const result = deps.config.togglePin(params.data.id);
    return c.json(result);
  });

  return app;
}
