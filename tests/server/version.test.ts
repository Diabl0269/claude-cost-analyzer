/**
 * `GET /api/status` must report the real app version even when started as `node dist/server/cli.js`
 * (where `process.env.npm_package_version` is unset — that variable only exists inside an `npm
 * run` script), by reading `package.json` directly. See server/version.ts and server/cli.ts.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readPackageVersion } from '../../server/version.js';

describe('readPackageVersion', () => {
  it("reads this repo's real package.json version, not the 0.0.0 placeholder", () => {
    // server/version.ts itself, run from source under tsx — one level up from `server/`.
    const version = readPackageVersion(import.meta.url);
    expect(version).not.toBe('0.0.0');
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('finds package.json when the module sits one level deeper (simulating dist/server/cli.js)', () => {
    root = mkdtempSync(join(tmpdir(), 'cca-version-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf8');
    const distServerDir = join(root, 'dist', 'server');
    mkdirSync(distServerDir, { recursive: true });
    const fakeModuleUrl = pathToFileURL(join(distServerDir, 'cli.js')).href;
    expect(readPackageVersion(fakeModuleUrl)).toBe('9.9.9');
  });

  it('falls back to 0.0.0 when no package.json is found within the walk-up limit', () => {
    root = mkdtempSync(join(tmpdir(), 'cca-version-'));
    const fakeModuleUrl = pathToFileURL(join(root, 'cli.js')).href;
    expect(readPackageVersion(fakeModuleUrl)).toBe('0.0.0');
  });

  it('falls back to 0.0.0 when package.json exists but has no version field', () => {
    root = mkdtempSync(join(tmpdir(), 'cca-version-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
    const fakeModuleUrl = pathToFileURL(join(root, 'cli.js')).href;
    expect(readPackageVersion(fakeModuleUrl)).toBe('0.0.0');
  });

  it('falls back to 0.0.0 when package.json is invalid JSON', () => {
    root = mkdtempSync(join(tmpdir(), 'cca-version-'));
    writeFileSync(join(root, 'package.json'), '{ not json', 'utf8');
    const fakeModuleUrl = pathToFileURL(join(root, 'cli.js')).href;
    expect(readPackageVersion(fakeModuleUrl)).toBe('0.0.0');
  });
});
