/** Consistent `{ error: { code, message } }` envelope for every route (SPEC §7.2). */
import type { Context } from 'hono';

export type ErrorStatus = 400 | 401 | 403 | 404 | 500;

export function apiError(c: Context, status: ErrorStatus, code: string, message: string): Response {
  return c.json({ error: { code, message } }, status);
}

export function badRequest(c: Context, message: string): Response {
  return apiError(c, 400, 'bad_request', message);
}

export function notFound(c: Context, message: string): Response {
  return apiError(c, 404, 'not_found', message);
}

export function serverError(c: Context, message: string): Response {
  return apiError(c, 500, 'internal_error', message);
}
