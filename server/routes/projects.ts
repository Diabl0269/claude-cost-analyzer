/** `GET /api/projects` */
import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';
import { queryContext } from '../deps.js';
import { rangeQuerySchema } from '../schemas.js';
import { parseQuery } from '../validate.js';

export function projectsRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/', async (c) => {
    const query = parseQuery(c, rangeQuerySchema);
    if (!query.ok) return query.response;
    const result = await deps.store.listProjects(queryContext(deps.config), query.data);
    return c.json(result);
  });
  return app;
}
