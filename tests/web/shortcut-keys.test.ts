import { describe, expect, it } from 'vitest';
import { findShortcutKeys, type Shortcut } from '../../web/src/lib/keyboard.js';

const shortcuts: Shortcut[] = [
  { id: 'go-overview', keys: 'g o', description: 'Go to overview', group: 'Navigation', run: () => {} },
  { id: 'go-sessions', keys: 'g s', description: 'Go to sessions', group: 'Navigation', run: () => {} },
  { id: 'help', keys: '?', description: 'Keyboard shortcuts', group: 'View', run: () => {} },
  { id: 'cycle-theme', keys: 't', description: 'Cycle theme', group: 'View', run: () => {} },
];

describe('findShortcutKeys', () => {
  it('matches a palette command to the shortcut that does the same thing', () => {
    expect(findShortcutKeys(shortcuts, 'Overview')).toBe('g o');
    expect(findShortcutKeys(shortcuts, 'Sessions')).toBe('g s');
    expect(findShortcutKeys(shortcuts, 'Keyboard shortcuts')).toBe('?');
  });

  it('ignores case and trailing punctuation', () => {
    expect(findShortcutKeys(shortcuts, 'overview')).toBe('g o');
    expect(findShortcutKeys(shortcuts, 'Overview.')).toBe('g o');
  });

  it('returns undefined when nothing does the same thing', () => {
    expect(findShortcutKeys(shortcuts, 'Analytics · Tools')).toBeUndefined();
    expect(findShortcutKeys(shortcuts, 'Slate')).toBeUndefined();
    expect(findShortcutKeys([], 'Overview')).toBeUndefined();
  });
});
