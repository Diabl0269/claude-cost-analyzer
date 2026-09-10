import { Dialog } from '@/components/Dialog';
import { formatShortcut, type Shortcut } from '@/lib/keyboard';
import styles from './ShortcutsDialog.module.css';

export interface StaticShortcutGroup {
  group: string;
  items: { keys: string; description: string }[];
}

export interface ShortcutsDialogProps {
  open: boolean;
  shortcuts: Shortcut[];
  onClose: () => void;
  /** context-dependent keys handled by a component (table rows, transcript turns) */
  extra?: StaticShortcutGroup[];
}

const GROUP_ORDER = ['Navigation', 'Search', 'Rows', 'Session', 'View'];

/** The `?` sheet. Lists whatever is registered right now, grouped. */
export function ShortcutsDialog({ open, shortcuts, onClose, extra = [] }: ShortcutsDialogProps) {
  const groups = new Map<string, Shortcut[]>();
  for (const shortcut of shortcuts) {
    const list = groups.get(shortcut.group) ?? [];
    list.push(shortcut);
    groups.set(shortcut.group, list);
  }
  const rank = (group: string): number => {
    const index = GROUP_ORDER.indexOf(group);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while you are typing in a field."
      size="md"
    >
      <div className={styles.groups}>
        {ordered.map(([group, items]) => (
          <section key={group}>
            <h3 className={styles.groupTitle}>{group}</h3>
            <dl className={styles.list}>
              {items.map((shortcut) => (
                <div key={shortcut.id} className={styles.row}>
                  <dt className={styles.description}>{shortcut.description}</dt>
                  <dd className={styles.keys}>
                    {formatShortcut(shortcut.keys).map((step, index) => (
                      <kbd key={`${shortcut.id}-${index}`}>{step}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {extra.map((section) => (
          <section key={section.group}>
            <h3 className={styles.groupTitle}>{section.group}</h3>
            <dl className={styles.list}>
              {section.items.map((item) => (
                <div key={item.keys} className={styles.row}>
                  <dt className={styles.description}>{item.description}</dt>
                  <dd className={styles.keys}>
                    {formatShortcut(item.keys).map((step, index) => (
                      <kbd key={`${item.keys}-${index}`}>{step}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
