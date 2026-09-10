/**
 * Reads the app version from the repo's `package.json` at runtime, so `GET /api/status` reports
 * something other than the placeholder `0.0.0` when the server is started from the built
 * `dist/server/cli.js` (where `process.env.npm_package_version` is never set — that only exists
 * inside an `npm run` script).
 *
 * `server/cli.ts` (source, under `node --import tsx/esm`) and `dist/server/cli.js` (built) sit at
 * different depths relative to the repo root package.json, so this walks upward from the current
 * module's directory rather than hardcoding a relative path — the first `package.json` found
 * above `server/` (or `dist/server/`) is the app's own manifest. Falls back to `0.0.0` if
 * anything goes wrong (missing file, bad JSON, no `version` field): a wrong version string is
 * cosmetic, never worth crashing startup over.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FALLBACK_VERSION = '0.0.0';
const MAX_LEVELS_UP = 5;

export function readPackageVersion(fromUrl: string = import.meta.url): string {
  try {
    let dir = dirname(fileURLToPath(fromUrl));
    for (let i = 0; i < MAX_LEVELS_UP; i += 1) {
      const candidate = join(dir, 'package.json');
      try {
        const raw = readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw) as { version?: unknown; name?: unknown };
        // Guard against picking up an unrelated package.json (e.g. inside node_modules) by
        // requiring a `version` string; the repo root manifest always has one.
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
          return parsed.version;
        }
      } catch {
        // not here (or unreadable/invalid) — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through to fallback
  }
  return FALLBACK_VERSION;
}
