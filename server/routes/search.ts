/** `GET /api/search` */
import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';
import { queryContext } from '../deps.js';
import { searchQuerySchema } from '../schemas.js';
import { parseQuery } from '../validate.js';

export function searchRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/', async (c) => {
    const query = parseQuery(c, searchQuerySchema);
    if (!query.ok) return query.response;
    const result = await deps.store.search(query.data, queryContext(deps.config));
    return c.json(result);
  });
  return app;
}
