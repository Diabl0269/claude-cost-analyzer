import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import styles from './TreeNav.module.css';

export interface TreeNode {
  id: string;
  label: ReactNode;
  /** plain text used for type-ahead and the accessible name */
  text: string;
  children?: TreeNode[];
  /** trailing content, right-aligned (a cost, a count) */
  meta?: ReactNode;
  icon?: IconName;
}

export interface TreeNavProps {
  nodes: TreeNode[];
  /** accessible name of the tree */
  label: string;
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  /** controlled expansion */
  expandedIds?: ReadonlySet<string>;
  onExpandedChange?: (ids: Set<string>) => void;
  defaultExpandedIds?: string[];
  dense?: boolean;
}

interface FlatNode {
  node: TreeNode;
  level: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
}

/** WAI-ARIA tree: single tab stop, arrow keys, Home/End and type-ahead. */
export function TreeNav({
  nodes,
  label,
  selectedId,
  onSelect,
  expandedIds,
  onExpandedChange,
  defaultExpandedIds = [],
  dense = false,
}: TreeNavProps) {
  const rootRef = useRef<HTMLUListElement | null>(null);
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds));
  const expanded = expandedIds ?? internalExpanded;
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 });

  const flat = useMemo(() => {
    const list: FlatNode[] = [];
    const walk = (items: TreeNode[], level: number, parentId: string | null): void => {
      for (const node of items) {
        const hasChildren = Boolean(node.children && node.children.length > 0);
        const isExpanded = hasChildren && expanded.has(node.id);
        list.push({ node, level, parentId, hasChildren, expanded: isExpanded });
        if (isExpanded && node.children) walk(node.children, level + 1, node.id);
      }
    };
    walk(nodes, 1, null);
    return list;
  }, [nodes, expanded]);

  const activeId = focusedId && flat.some((item) => item.node.id === focusedId) ? focusedId : (selectedId ?? flat[0]?.node.id ?? null);
  const activeIndex = flat.findIndex((item) => item.node.id === activeId);

  const setExpanded = useCallback(
    (next: Set<string>) => {
      if (!expandedIds) setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [expandedIds, onExpandedChange],
  );

  const toggle = useCallback(
    (id: string, open: boolean) => {
      const next = new Set(expanded);
      if (open) next.add(id);
      else next.delete(id);
      setExpanded(next);
    },
    [expanded, setExpanded],
  );

  const focusNode = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();
    });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const next = Math.max(0, Math.min(activeIndex + delta, flat.length - 1));
      const target = flat[next];
      if (target) focusNode(target.node.id);
    },
    [flat, activeIndex, focusNode],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>): void => {
    const current = flat[activeIndex];
    if (!current) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (current.hasChildren && !current.expanded) toggle(current.node.id, true);
        else if (current.hasChildren) move(1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (current.hasChildren && current.expanded) toggle(current.node.id, false);
        else if (current.parentId) focusNode(current.parentId);
        return;
      case 'Home':
        event.preventDefault();
        move(-flat.length);
        return;
      case 'End':
        event.preventDefault();
        move(flat.length);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect?.(current.node);
        if (current.hasChildren) toggle(current.node.id, !current.expanded);
        return;
      case '*':
        event.preventDefault();
        setExpanded(new Set([...expanded, ...flat.filter((item) => item.level === current.level && item.hasChildren).map((item) => item.node.id)]));
        return;
      default:
        break;
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.buffer = now - state.at > 700 ? event.key : state.buffer + event.key;
      state.at = now;
      const needle = state.buffer.toLowerCase();
      const order = [...flat.slice(activeIndex + 1), ...flat.slice(0, activeIndex + 1)];
      const hit = order.find((item) => item.node.text.toLowerCase().startsWith(needle));
      if (hit) {
        event.preventDefault();
        focusNode(hit.node.id);
      }
    }
  };

  const renderNodes = (items: TreeNode[], level: number): ReactNode => (
    <>
      {items.map((node) => {
        const hasChildren = Boolean(node.children && node.children.length > 0);
        const isExpanded = hasChildren && expanded.has(node.id);
        const isSelected = selectedId === node.id;
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-selected={isSelected}
            aria-level={level}
            data-tree-id={node.id}
            tabIndex={node.id === activeId ? 0 : -1}
            className={[styles.item, isSelected ? styles.selected : null].filter(Boolean).join(' ')}
            onFocus={(event) => {
              event.stopPropagation();
              setFocusedId(node.id);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(node);
              if (hasChildren) toggle(node.id, !isExpanded);
              focusNode(node.id);
            }}
          >
            <span className={styles.rowInner} style={{ paddingLeft: `calc(${level - 1} * var(--s4))` }}>
              {hasChildren ? (
                <Icon name="chevron" size={11} rotate={isExpanded ? 90 : 0} className={styles.twisty} />
              ) : (
                <span className={styles.twistySpacer} aria-hidden="true" />
              )}
              {node.icon ? <Icon name={node.icon} size={13} className={styles.icon} /> : null}
              <span className={styles.label}>{node.label}</span>
              {node.meta ? <span className={styles.meta}>{node.meta}</span> : null}
            </span>
            {hasChildren && isExpanded ? (
              <ul role="group" className={styles.group}>
                {renderNodes(node.children ?? [], level + 1)}
              </ul>
            ) : null}
          </li>
        );
      })}
    </>
  );

  return (
    <ul
      ref={rootRef}
      role="tree"
      aria-label={label}
      className={[styles.tree, dense ? styles.dense : null].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {renderNodes(nodes, 1)}
    </ul>
  );
}
