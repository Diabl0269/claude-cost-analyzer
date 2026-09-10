/**
 * Silences the one `ExperimentalWarning` that `node:sqlite` emits on load (SPEC §1.8) and leaves
 * every other process warning printing normally.
 *
 * This lives in its own module because ES module imports are evaluated before the importing
 * module's own statements: a filter written at the top of `cli.ts` would run *after*
 * `node:sqlite` had already been loaded (and had already warned) by the import graph below it.
 * Importing this module first is the only ordering that works. `server/worker.ts` imports it for
 * the same reason — worker threads get their own `process` warning listeners, so the main
 * thread's filter does not cover them.
 */
function isSqliteExperimentalWarning(warning: Error): boolean {
  return warning.name === 'ExperimentalWarning' && /sqlite/i.test(warning.message);
}

export function filterSqliteExperimentalWarning(): void {
  const existing = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning: Error) => {
    if (isSqliteExperimentalWarning(warning)) return;
    for (const listener of existing) listener(warning);
    if (existing.length === 0) console.warn(warning);
  });
}

filterSqliteExperimentalWarning();
