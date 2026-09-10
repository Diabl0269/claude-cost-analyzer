/**
 * Resolves CCA_HOME (the app's own data directory) and the paths inside it, plus the
 * transcript roots to index. Ensures directories/files have restrictive permissions since
 * the DB and config may contain (derived) cost data for the user's private transcripts.
 */
import { existsSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

const DEFAULT_HOME_DIRNAME = '.claude-cost-analyzer';
const DEFAULT_ROOT = '~/.claude/projects';
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Expands a leading `~` (or `~/…`) to the current user's home directory. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith(`~${sep}`) || path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export interface ResolvedPaths {
  /** CCA_HOME: directory holding index.sqlite and config.json */
  home: string;
  dbPath: string;
  configPath: string;
}

export interface ResolvePathsOptions {
  /** --home flag; falls back to CCA_HOME env; falls back to ~/.claude-cost-analyzer */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** Resolves CCA_HOME and the file paths inside it. Does not touch the filesystem. */
export function resolvePaths(opts: ResolvePathsOptions = {}): ResolvedPaths {
  const env = opts.env ?? process.env;
  const rawHome = opts.home ?? env.CCA_HOME ?? join('~', DEFAULT_HOME_DIRNAME);
  const home = resolve(expandHome(rawHome));
  return {
    home,
    dbPath: join(home, 'index.sqlite'),
    configPath: join(home, 'config.json'),
  };
}

/** Creates CCA_HOME with mode 0700 if missing; tightens permissions if it already exists. */
export function ensureHomeDir(home: string): void {
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: DIR_MODE });
  }
  try {
    chmodSync(home, DIR_MODE);
  } catch {
    // best-effort on filesystems that don't support unix permission bits (unusual for CCA_HOME)
  }
}

/** Tightens a file inside CCA_HOME to mode 0600 after it has been written. */
export function ensureFileMode(path: string): void {
  if (!existsSync(path)) return;
  try {
    chmodSync(path, FILE_MODE);
  } catch {
    // best-effort; see ensureHomeDir
  }
}

export interface ResolveRootsOptions {
  /** roots from UserSettings, already persisted */
  settingsRoots?: string[];
  /** --claude-dir CLI flag */
  claudeDirFlag?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves the transcript roots to index. `--claude-dir`/`CCA_CLAUDE_DIR` override the
 * configured roots entirely (single root); otherwise the settings roots are used, falling
 * back to `~/.claude/projects`. All results are absolute, `~`-expanded paths.
 */
export function resolveRoots(opts: ResolveRootsOptions = {}): string[] {
  const env = opts.env ?? process.env;
  const override = opts.claudeDirFlag ?? env.CCA_CLAUDE_DIR;
  if (override) return [resolve(expandHome(override))];
  const roots = opts.settingsRoots && opts.settingsRoots.length > 0 ? opts.settingsRoots : [DEFAULT_ROOT];
  return roots.map((r) => resolve(expandHome(r)));
}

/** True when `child` is `dir` or a path inside it, after normalization (guards path traversal). */
export function isInside(dir: string, child: string): boolean {
  const normalizedDir = resolve(dir);
  const normalizedChild = resolve(child);
  if (normalizedChild === normalizedDir) return true;
  return normalizedChild.startsWith(normalizedDir.endsWith(sep) ? normalizedDir : normalizedDir + sep);
}

/** Directory existence check that never throws (used by the watcher to skip missing roots). */
export function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isAbsolutePath(path: string): boolean {
  return isAbsolute(path);
}
