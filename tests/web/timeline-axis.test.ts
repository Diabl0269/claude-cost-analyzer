import { describe, expect, it } from 'vitest';
import { SHORT_SPAN_MS, axisFractions, elapsedTick } from '../../web/src/routes/session/timeline-axis.js';

describe('elapsedTick', () => {
  it('counts whole seconds on a session under two minutes', () => {
    expect(elapsedTick(0, 60_000)).toBe('0s');
    expect(elapsedTick(20_000, 60_000)).toBe('20s');
    expect(elapsedTick(40_400, 60_000)).toBe('40s');
    expect(elapsedTick(60_000, 60_000)).toBe('60s');
  });

  it('adds minutes on a longer session', () => {
    expect(elapsedTick(0, 300_000)).toBe('0s');
    expect(elapsedTick(45_000, 300_000)).toBe('45s');
    expect(elapsedTick(75_000, 300_000)).toBe('1m 15s');
    expect(elapsedTick(120_000, 300_000)).toBe('2m');
  });

  it('rounds to seconds before splitting, so no tick reads 4m 60s', () => {
    expect(elapsedTick(299_600, 300_000)).toBe('5m');
    expect(elapsedTick(119_900, 300_000)).toBe('2m');
    expect(elapsedTick(89_500, 300_000)).toBe('1m 30s');
  });

  it('never prints a negative offset', () => {
    expect(elapsedTick(-500, 60_000)).toBe('0s');
  });
});

describe('axisFractions', () => {
  it('labels both ends of a clock and five points of an elapsed axis', () => {
    expect(axisFractions(false)).toEqual([0, 1]);
    expect(axisFractions(true)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('switches at an hour', () => {
    expect(SHORT_SPAN_MS).toBe(3_600_000);
  });
});
