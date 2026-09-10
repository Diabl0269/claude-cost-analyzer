/** `GET /api/events` — server-sent events stream of `IndexEvent`s. */
import { Hono } from 'hono';
import type { AppDeps } from '../deps.js';

export function eventsRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/', (c) => deps.sse.handler(c));
  return app;
}
