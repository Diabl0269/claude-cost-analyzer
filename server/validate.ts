/** Thin zod validation helpers shared by every route: parse query/body, never echo raw input. */
import type { Context } from 'hono';
import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

export type Validated<T> = { ok: true; data: T } | { ok: false; response: Response };

function fieldList(error: { issues: { path: PropertyKey[] }[] }): string {
  const fields = error.issues.map((issue) => issue.path.join('.') || '(root)');
  return [...new Set(fields)].join(', ');
}

export function parseQuery<T>(c: Context, schema: ZodType<T>): Validated<T> {
  const raw = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: badRequest(c, `invalid query parameter(s): ${fieldList(result.error)}`) };
  }
  return { ok: true, data: result.data };
}

export function parseParams<T>(c: Context, schema: ZodType<T>): Validated<T> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) {
    return { ok: false, response: badRequest(c, `invalid path parameter(s): ${fieldList(result.error)}`) };
  }
  return { ok: true, data: result.data };
}

export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<Validated<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: badRequest(c, 'request body must be valid JSON') };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: badRequest(c, `invalid request body field(s): ${fieldList(result.error)}`) };
  }
  return { ok: true, data: result.data };
}
