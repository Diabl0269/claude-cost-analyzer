/**
 * A `stop_hook_summary` line only ever carries `command` + `durationMs`, never `hookName` (see
 * core/parse/attachments.ts `readStopHookSummary`), so those rows aggregate under the literal
 * placeholder `hookName: '(unnamed)'`. `displayNameOf` derives a presentable label from the hook
 * event plus a short command-derived label instead, without changing `hookName` itself (kept for
 * back compat) — see core/db/analytics.ts.
 */
import { describe, expect, it } from 'vitest';
import { commandLabel, displayNameOf } from '../../../core/db/analytics.js';

describe('commandLabel', () => {
  it('takes the basename of the first token of the command', () => {
    expect(commandLabel('/usr/local/bin/notify-stop.sh --quiet')).toBe('notify-stop.sh');
    expect(commandLabel('notify-stop.sh')).toBe('notify-stop.sh');
    expect(commandLabel(undefined)).toBeUndefined();
    expect(commandLabel('')).toBeUndefined();
  });
});

describe('displayNameOf', () => {
  it('derives "<event> · <command label>" for an unnamed Stop hook', () => {
    expect(displayNameOf('(unnamed)', 'Stop', '/usr/local/bin/notify-stop.sh --quiet')).toBe(
      'Stop · notify-stop.sh',
    );
  });

  it('falls back to just the hook event when there is no command', () => {
    expect(displayNameOf('(unnamed)', 'Stop', undefined)).toBe('Stop');
  });

  it('falls back to just the command label when there is no hook event', () => {
    expect(displayNameOf('(unnamed)', undefined, 'notify-stop.sh')).toBe('notify-stop.sh');
  });

  it('falls back to the placeholder when neither is available', () => {
    expect(displayNameOf('(unnamed)', undefined, undefined)).toBe('(unnamed)');
  });

  it('echoes a real hookName untouched', () => {
    expect(displayNameOf('PostToolUse', 'PostToolUse', 'lint.sh')).toBe('PostToolUse');
  });
});
