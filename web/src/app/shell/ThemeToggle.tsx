import { IconButton } from '@/components/IconButton';
import { THEME_LABELS, useTheme } from '@/lib/theme';

/** Cycles system → paper → slate. The icon shows the theme in effect. */
export function ThemeToggle() {
  const { theme, resolved, cycleTheme } = useTheme();
  const next = theme === 'system' ? 'paper' : theme === 'paper' ? 'slate' : 'system';
  return (
    <IconButton
      icon={theme === 'system' ? 'settings' : resolved === 'slate' ? 'moon' : 'sun'}
      label={`Theme: ${THEME_LABELS[theme]}. Switch to ${THEME_LABELS[next].toLowerCase()}`}
      onClick={cycleTheme}
    />
  );
}
