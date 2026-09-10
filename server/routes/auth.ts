/** `POST /api/auth/session` — issues the session cookie (SPEC §7.3). Sits behind hostGuard only. */
import { Hono } from 'hono';
import { issueSessionHandler, type AuthState } from '../auth.js';

export function authRoutes(state: AuthState): Hono {
  const app = new Hono();
  app.post('/session', issueSessionHandler(state));
  return app;
}
