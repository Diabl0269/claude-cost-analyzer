import { describe, expect, it } from 'vitest';
import { parseFlags } from '../../server/cli-flags.js';

const env = {};

describe('parseFlags', () => {
  it('defaults to no demo, port 4141, open true', () => {
    const flags = parseFlags([], env);
    expect(flags.demo).toBe(false);
    expect(flags.port).toBe(4141);
    expect(flags.open).toBe(true);
    expect(flags.demoSeed).toBeUndefined();
    expect(flags.demoSessions).toBeUndefined();
  });

  it('parses --demo alone', () => {
    const flags = parseFlags(['--demo'], env);
    expect(flags.demo).toBe(true);
  });

  it('parses --demo with --seed and --sessions', () => {
    const flags = parseFlags(['--demo', '--seed', '42', '--sessions', '10'], env);
    expect(flags.demo).toBe(true);
    expect(flags.demoSeed).toBe(42);
    expect(flags.demoSessions).toBe(10);
  });

  it('rejects --demo combined with --claude-dir', () => {
    expect(() => parseFlags(['--demo', '--claude-dir', '/tmp/x'], env)).toThrow(
      '--demo and --claude-dir are mutually exclusive',
    );
  });

  it('rejects a non-numeric --seed', () => {
    expect(() => parseFlags(['--demo', '--seed', 'nope'], env)).toThrow('invalid --seed value');
  });

  it('rejects a zero or negative --sessions', () => {
    expect(() => parseFlags(['--demo', '--sessions', '0'], env)).toThrow('invalid --sessions value');
    expect(() => parseFlags(['--demo', '--sessions', '-3'], env)).toThrow('invalid --sessions value');
  });

  it('ignores --seed/--sessions validation when --demo is absent', () => {
    // Someone could still pass these without --demo; parseFlags doesn't reject that (they're
    // simply unused), it only validates them when --demo is set.
    const flags = parseFlags(['--seed', 'nope'], env);
    expect(flags.demo).toBe(false);
    expect(Number.isNaN(flags.demoSeed)).toBe(true);
  });

  it('rejects an invalid --port', () => {
    expect(() => parseFlags(['--port', '0'], env)).toThrow('invalid --port value');
    expect(() => parseFlags(['--port', 'nope'], env)).toThrow('invalid --port value');
  });

  it('CCA_PORT env sets the default port, --port overrides it', () => {
    expect(parseFlags([], { CCA_PORT: '5000' }).port).toBe(5000);
    expect(parseFlags(['--port', '6000'], { CCA_PORT: '5000' }).port).toBe(6000);
  });
});
