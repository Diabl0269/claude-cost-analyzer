import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAnnounce } from '@/lib/a11y';
import { useMediaQuery } from '@/lib/media';
import { Icon } from '@/components/Icon';
import { Skeleton } from '@/components/Skeleton';
import { compareValues, moneySlot, pathIsSortable, sortReader, type LedgerSortValue } from './columns';
import styles from './LedgerTable.module.css';

export type SortDirection = 'asc' | 'desc';

export interface LedgerSort {
  columnId: string;
  direction: SortDirection;
}

export interface LedgerColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** numeric columns are right-aligned and set in tabular mono */
  numeric?: boolean;
  align?: 'left' | 'right' | 'center';
  /** any CSS width (`120px`, `minmax(0, 1fr)` is not supported — this is a real table) */
  width?: string;
  /**
   * Makes the column sortable: a reader, or a dotted path into the row (`sortValue: 'cost.total'`
   * is the same as `sortValue: (row) => row.cost.total`).
   */
  sortValue?: LedgerSortValue<Row>;
  headerTitle?: string;
  /** sits beside the header label, outside the sort button — an `<EstimateBadge>`, a unit */
  headerAside?: ReactNode;
  /** drops the column under 900px */
  secondary?: boolean;
  /**
   * The amount this column prints, when it is not what `sortValue` reads. The table derives the
   * column's decimal alignment from every value in it, so all its `<Money>` line up.
   */
  moneyValue?: (row: Row) => number | null | undefined;
}

/** A spanning label above two or more adjacent columns (`5m` + `1h` under "Cache write"). */
export interface LedgerColumnGroup {
  id: string;
  /** a string, or a node when the label carries a badge or a tooltip of its own */
  label: ReactNode;
  /** column ids, which must be adjacent in `columns` */
  columns: string[];
}

/** A named key that acts on the focused row (`p` to pin), announced in the row's description. */
export interface LedgerRowAction<Row> {
  /** a single character, matched case-insensitively */
  key: string;
  /** what it does, in the imperative ("pin this session") */
  label: string;
  run: (row: Row, index: number) => void;
}

export interface LedgerTableProps<Row> {
  columns: LedgerColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** describes the table for screen readers; shown when `showCaption` */
  caption: string;
  showCaption?: boolean;
  sort?: LedgerSort;
  defaultSort?: LedgerSort;
  onSortChange?: (sort: LedgerSort) => void;
  /** the caller sorts the rows itself (server-side sorting) */
  manualSort?: boolean;
  /** every column whose `id` is a readable field of the row becomes sortable by that field */
  autoSort?: boolean;
  /** spanning labels above the header row */
  columnGroups?: LedgerColumnGroup[];
  onActivateRow?: (row: Row, index: number) => void;
  /** what Enter does, for the row description ("opens this session") */
  activateLabel?: string;
  /** keys that act on the focused row; they replace per-row tab stops */
  rowActions?: LedgerRowAction<Row>[];
  /**
   * `roving` (the default) keeps one tab stop per table: the row is the tab stop and the
   * controls inside it are reached with → or F2. `natural` leaves every control in the tab
   * order — for a table that is really a form grid, like the pricing editor.
   */
  rowTabStops?: 'roving' | 'natural';
  /** highlights the current row (`rowKey` value) */
  selectedKey?: string | null;
  /** checkbox column; omit for a plain table */
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  dense?: boolean;
  /** one cell per column, rendered in a sticky <tfoot> */
  footer?: ReactNode[];
  maxHeight?: number | string;
  /** rows above this count are virtualized (default 200) — needs `maxHeight` to have an effect */
  virtualizeThreshold?: number;
  rowHeight?: number;
}

/** Anything a browser puts in the tab order on its own. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

function isTextEntry(node: Element | null): boolean {
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
  return node instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(node.type);
}

/**
 * The ledger: hairline rows, right-aligned numerals with their decimal points on one line,
 * sticky header, `aria-sort`, roving-tabindex row navigation, and virtualization once the list
 * gets long.
 *
 * **One tab stop per table.** A pin button, a title link and a chain link in every row is three
 * extra tab stops per row — a thousand of them on `/sessions`, which is not a keyboard design at
 * all. So in-row controls are taken out of the tab order (`data-ledger-tabbable` opts one back
 * in) and reached from the focused row instead: Enter activates the row, `rowActions` keys act on
 * it, and → or F2 moves into its controls (Escape or ← comes back). The keys are named in the
 * description every row carries.
 */
export function LedgerTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  showCaption = false,
  sort,
  defaultSort,
  onSortChange,
  manualSort = false,
  autoSort = false,
  columnGroups,
  onActivateRow,
  activateLabel = 'opens this row',
  rowActions,
  rowTabStops = 'roving',
  selectedKey,
  selectedKeys,
  onSelectionChange,
  loading = false,
  skeletonRows = 8,
  empty,
  dense = false,
  footer,
  maxHeight,
  virtualizeThreshold = 200,
  rowHeight,
}: LedgerTableProps<Row>) {
  const announce = useAnnounce();
  // The same 900px breakpoint the stylesheet drops `secondary` columns at. A group's `colSpan`
  // has to count only the columns that are actually rendered, or it spills over its neighbours
  // once two of the four columns under it are hidden.
  const dropsSecondary = useMediaQuery('(max-width: 900px)');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const helpId = useId();
  const [internalSort, setInternalSort] = useState<LedgerSort | null>(defaultSort ?? null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [pendingFocus, setPendingFocus] = useState(false);
  const [hasRowControls, setHasRowControls] = useState(false);
  const activeSort = sort ?? internalSort;
  const rowPx = rowHeight ?? (dense ? 28 : 36);
  const selectable = Boolean(selectedKeys && onSelectionChange);
  const roving = rowTabStops === 'roving';

  // `autoSort` reads each column's own id as a field of the row, so marking a column sortable is
  // a matter of not needing to write the accessor at all.
  const resolved = useMemo(() => {
    const sample = rows[0];
    return columns.map((column) => {
      if (column.sortValue !== undefined) return { column, sortValue: column.sortValue };
      if (autoSort && sample !== undefined && pathIsSortable(sample, column.id)) {
        return { column, sortValue: column.id as LedgerSortValue<Row> };
      }
      return { column, sortValue: undefined };
    });
  }, [columns, rows, autoSort]);

  const sortValueOf = useCallback(
    (columnId: string): LedgerSortValue<Row> | undefined => resolved.find((entry) => entry.column.id === columnId)?.sortValue,
    [resolved],
  );

  const sortedRows = useMemo(() => {
    if (manualSort || !activeSort) return rows;
    const sortValue = sortValueOf(activeSort.columnId);
    if (!sortValue) return rows;
    const read = sortReader(sortValue);
    const factor = activeSort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compareValues(read(a), read(b)) * factor);
  }, [rows, activeSort, manualSort, sortValueOf]);

  /**
   * One decimal slot per column, derived from every value in it: `$0.06`, `$0.0070` and `$0.27`
   * in one column reserve four fraction digits, so all three decimal points line up without a
   * digit being rounded away. Handed to the cells as a custom property, which `<Money>` reads.
   */
  const moneySlots = useMemo(() => {
    const slots = new Map<string, string>();
    for (const { column, sortValue } of resolved) {
      const fromSort = sortValue === undefined ? null : sortReader(sortValue);
      const read =
        column.moneyValue ??
        (column.numeric === true && fromSort !== null
          ? (row: Row) => {
              const value = fromSort(row);
              return typeof value === 'number' ? value : Number.NaN;
            }
          : null);
      if (!read) continue;
      const slot = moneySlot(rows.map(read));
      if (slot !== null) slots.set(column.id, slot);
    }
    return slots;
  }, [resolved, rows]);

  const cellStyle = useCallback(
    (columnId: string): CSSProperties | undefined => {
      const slot = moneySlots.get(columnId);
      return slot === undefined ? undefined : ({ ['--money-frac']: slot } as CSSProperties);
    },
    [moneySlots],
  );

  const toggleSort = useCallback(
    (column: LedgerColumn<Row>) => {
      if (!sortValueOf(column.id)) return;
      const next: LedgerSort = {
        columnId: column.id,
        direction: activeSort?.columnId === column.id && activeSort.direction === 'desc' ? 'asc' : 'desc',
      };
      if (!sort) setInternalSort(next);
      onSortChange?.(next);
      announce(`Sorted by ${column.headerTitle ?? column.id}, ${next.direction === 'asc' ? 'ascending' : 'descending'}`);
    },
    [activeSort, sort, onSortChange, announce, sortValueOf],
  );

  // Virtualization needs somewhere to scroll. Without `maxHeight` the scroller is the page's own
  // height and never scrolls, so the virtualizer renders every row anyway — all it added was an
  // `aria-rowcount` promising a window that was not there. Long lists must set `maxHeight`.
  const virtualize = sortedRows.length > virtualizeThreshold && maxHeight !== undefined;
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowPx,
    overscan: 12,
    enabled: virtualize,
  });

  const rowNode = useCallback(
    (index: number): HTMLElement | null => scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`) ?? null,
    [],
  );

  const focusRow = useCallback(
    (index: number) => {
      const node = rowNode(index);
      node?.focus();
      return Boolean(node);
    },
    [rowNode],
  );

  const controlsIn = useCallback(
    (index: number): HTMLElement[] => {
      const row = rowNode(index);
      if (!row) return [];
      return [...row.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.dataset.ledgerSkip === undefined);
    },
    [rowNode],
  );

  const moveFocus = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, sortedRows.length - 1));
      setFocusedIndex(clamped);
      if (virtualize) {
        virtualizer.scrollToIndex(clamped, { align: 'auto' });
        setPendingFocus(true);
      } else {
        requestAnimationFrame(() => focusRow(clamped));
      }
    },
    [sortedRows.length, virtualize, virtualizer, focusRow],
  );

  useEffect(() => {
    if (!pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      if (focusRow(focusedIndex)) setPendingFocus(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, focusedIndex, focusRow]);

  /**
   * Takes the row's own controls out of the tab order on every render — rows are recreated by
   * sorting, filtering and virtualization, and a control that came back tabbable would put the
   * thousand tab stops right back. `data-ledger-tabbable` on a control keeps it in the order.
   */
  useEffect(() => {
    if (!roving) return;
    const body = scrollRef.current?.querySelector('tbody');
    if (!body) return;
    let found = false;
    for (const node of body.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (node.tagName === 'TR') continue;
      if (node.dataset.ledgerTabbable !== undefined) continue;
      found = true;
      if (node.getAttribute('tabindex') !== '-1') node.setAttribute('tabindex', '-1');
    }
    setHasRowControls((current) => (current === found ? current : found));
  });

  /** The sentence every row is described by: what Enter does, and which keys act on the row. */
  const rowHelp = useMemo(() => {
    const parts: string[] = [];
    if (onActivateRow) parts.push(`Enter ${activateLabel}`);
    for (const action of rowActions ?? []) parts.push(`${action.key} ${action.label}`);
    if (roving && hasRowControls) parts.push('right arrow reaches this row’s buttons');
    return parts.length > 0 ? `${parts.join('; ')}.` : '';
  }, [onActivateRow, activateLabel, rowActions, roving, hasRowControls]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTableSectionElement>): void => {
    const target = event.target as HTMLElement;
    const onRow = target.tagName === 'TR';

    // Focus is inside one of the row's own controls: only leaving it is ours to handle, so a
    // caret key still moves a caret and ↑/↓ in a number field still steps its value.
    if (!onRow) {
      if (event.key === 'Escape' || (event.key === 'ArrowLeft' && !isTextEntry(target))) {
        const controls = controlsIn(focusedIndex);
        const position = controls.indexOf(target);
        if (event.key === 'ArrowLeft' && position > 0) {
          event.preventDefault();
          controls[position - 1]?.focus();
          return;
        }
        event.preventDefault();
        focusRow(focusedIndex);
      } else if (event.key === 'ArrowRight' && !isTextEntry(target)) {
        const controls = controlsIn(focusedIndex);
        const position = controls.indexOf(target);
        if (position >= 0 && position < controls.length - 1) {
          event.preventDefault();
          controls[position + 1]?.focus();
        }
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(focusedIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(focusedIndex - 1);
        return;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        return;
      case 'End':
        event.preventDefault();
        moveFocus(sortedRows.length - 1);
        return;
      case 'PageDown':
        event.preventDefault();
        moveFocus(focusedIndex + 10);
        return;
      case 'PageUp':
        event.preventDefault();
        moveFocus(focusedIndex - 10);
        return;
      case 'ArrowRight':
      case 'F2': {
        const first = controlsIn(focusedIndex)[0];
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      case 'Enter':
      case ' ': {
        const row = sortedRows[focusedIndex];
        if (row && onActivateRow) {
          event.preventDefault();
          onActivateRow(row, focusedIndex);
        }
        return;
      }
      default:
        break;
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.key.length !== 1) return;
    const action = (rowActions ?? []).find((candidate) => candidate.key.toLowerCase() === event.key.toLowerCase());
    const row = sortedRows[focusedIndex];
    if (action && row) {
      event.preventDefault();
      action.run(row, focusedIndex);
    }
  };

  const toggleSelection = (key: string): void => {
    if (!selectedKeys || !onSelectionChange) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange(next);
  };

  const allSelected = selectedKeys ? sortedRows.length > 0 && sortedRows.every((row) => selectedKeys.has(rowKey(row))) : false;

  const groupRow = useMemo(() => {
    if (!columnGroups || columnGroups.length === 0) return null;
    const owner = new Map<string, LedgerColumnGroup>();
    for (const group of columnGroups) {
      for (const id of group.columns) owner.set(id, group);
    }
    const cells: { key: string; label?: ReactNode; span: number; secondary?: boolean }[] = [];
    for (const column of columns) {
      if (dropsSecondary && column.secondary) continue;
      const group = owner.get(column.id);
      const last = cells[cells.length - 1];
      if (group && last && last.key === group.id) {
        last.span += 1;
        continue;
      }
      cells.push(group ? { key: group.id, label: group.label, span: 1 } : { key: `gap-${column.id}`, span: 1, secondary: column.secondary });
    }
    return cells;
  }, [columnGroups, columns, dropsSecondary]);

  const headerRows = groupRow ? 2 : 1;

  const renderCells = (row: Row, index: number): ReactNode => (
    <>
      {selectable ? (
        <td className={styles.selectCell}>
          <input
            type="checkbox"
            checked={selectedKeys?.has(rowKey(row)) ?? false}
            aria-label={`Select row ${index + 1}`}
            tabIndex={-1}
            onChange={() => toggleSelection(rowKey(row))}
            onClick={(event) => event.stopPropagation()}
          />
        </td>
      ) : null}
      {columns.map((column) => (
        <td
          key={column.id}
          style={cellStyle(column.id)}
          className={[
            styles.cell,
            column.numeric ? `num ${styles.numeric}` : null,
            column.align === 'right' ? styles.numeric : null,
            column.align === 'center' ? styles.center : null,
            column.secondary ? styles.secondary : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {column.cell(row, index)}
        </td>
      ))}
    </>
  );

  const rowProps = (index: number, key: string) => ({
    'data-row-index': index,
    tabIndex: index === focusedIndex ? 0 : -1,
    'aria-selected': selectedKey === key ? true : undefined,
    'aria-describedby': rowHelp === '' ? undefined : helpId,
    className: [styles.row, selectedKey === key ? styles.current : null].filter(Boolean).join(' '),
    onFocus: () => setFocusedIndex(index),
  });

  const body = (): ReactNode => {
    if (loading) {
      return Array.from({ length: skeletonRows }, (_, index) => (
        <tr key={`skeleton-${index}`} className={styles.row} style={{ height: rowPx }}>
          {selectable ? <td className={styles.selectCell} /> : null}
          {columns.map((column) => (
            <td key={column.id} className={styles.cell}>
              <Skeleton width={column.numeric ? 56 : '70%'} height={10} />
            </td>
          ))}
        </tr>
      ));
    }

    if (sortedRows.length === 0) {
      return (
        <tr>
          <td className={styles.emptyCell} colSpan={columns.length + (selectable ? 1 : 0)}>
            {empty ?? 'Nothing to show for this range.'}
          </td>
        </tr>
      );
    }

    if (!virtualize) {
      return sortedRows.map((row, index) => {
        const key = rowKey(row);
        return (
          <tr key={key} {...rowProps(index, key)} style={{ height: rowPx }} onClick={() => onActivateRow?.(row, index)}>
            {renderCells(row, index)}
          </tr>
        );
      });
    }

    const items = virtualizer.getVirtualItems();
    const first = items[0];
    const paddingTop = first ? first.start : 0;
    const paddingBottom = first ? virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0) : 0;
    const span = columns.length + (selectable ? 1 : 0);

    return (
      <>
        {paddingTop > 0 ? (
          <tr aria-hidden="true" style={{ height: paddingTop }}>
            <td colSpan={span} />
          </tr>
        ) : null}
        {items.map((item) => {
          const row = sortedRows[item.index];
          if (!row) return null;
          const key = rowKey(row);
          return (
            <tr
              key={key}
              {...rowProps(item.index, key)}
              aria-rowindex={item.index + 1 + headerRows}
              style={{ height: item.size }}
              onClick={() => onActivateRow?.(row, item.index)}
            >
              {renderCells(row, item.index)}
            </tr>
          );
        })}
        {paddingBottom > 0 ? (
          <tr aria-hidden="true" style={{ height: paddingBottom }}>
            <td colSpan={span} />
          </tr>
        ) : null}
      </>
    );
  };


  return (
    <div
      ref={scrollRef}
      className={[styles.scroller, dense ? styles.dense : null].filter(Boolean).join(' ')}
      style={maxHeight === undefined ? undefined : { maxHeight, overflowY: 'auto' }}
    >
      {rowHelp === '' ? null : (
        <div id={helpId} className="visually-hidden">
          {rowHelp}
        </div>
      )}
      <table
        className={styles.table}
        aria-rowcount={virtualize ? sortedRows.length + headerRows : undefined}
        aria-busy={loading || undefined}
      >
        <caption className={showCaption ? styles.caption : 'visually-hidden'}>{caption}</caption>
        <thead className={styles.head}>
          {groupRow ? (
            <tr>
              {selectable ? <td /> : null}
              {groupRow.map((cell) =>
                cell.label === undefined ? (
                  <td key={cell.key} className={cell.secondary ? styles.secondary : undefined} />
                ) : (
                  <th key={cell.key} scope="colgroup" colSpan={cell.span} className={styles.groupCell}>
                    {cell.label}
                  </th>
                ),
              )}
            </tr>
          ) : null}
          <tr>
            {selectable ? (
              <th scope="col" className={styles.selectCell}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label={allSelected ? 'Clear selection' : 'Select all rows'}
                  onChange={() => onSelectionChange?.(allSelected ? new Set() : new Set(sortedRows.map(rowKey)))}
                />
              </th>
            ) : null}
            {resolved.map(({ column, sortValue }) => {
              const sorted = activeSort?.columnId === column.id;
              return (
                <th
                  key={column.id}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={sorted ? (activeSort?.direction === 'asc' ? 'ascending' : 'descending') : sortValue ? 'none' : undefined}
                  className={[
                    styles.headCell,
                    column.numeric || column.align === 'right' ? styles.numeric : null,
                    column.align === 'center' ? styles.center : null,
                    column.secondary ? styles.secondary : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.headInner}>
                    {sortValue ? (
                      <button
                        type="button"
                        className={`${styles.headBox} ${styles.sortButton}`}
                        onClick={() => toggleSort(column)}
                        title={column.headerTitle}
                      >
                        <span>{column.header}</span>
                        <Icon
                          name="chevron"
                          size={11}
                          rotate={sorted && activeSort?.direction === 'asc' ? -90 : 90}
                          className={sorted ? styles.sortIconActive : styles.sortIcon}
                        />
                      </button>
                    ) : (
                      <span className={styles.headBox} title={column.headerTitle}>
                        {column.header}
                      </span>
                    )}
                    {column.headerAside}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>{body()}</tbody>
        {footer ? (
          <tfoot className={styles.foot}>
            <tr>
              {selectable ? <td /> : null}
              {footer.map((cell, index) => (
                <td
                  key={columns[index]?.id ?? index}
                  style={cellStyle(columns[index]?.id ?? '')}
                  className={[
                    styles.cell,
                    columns[index]?.numeric ? `num ${styles.numeric}` : null,
                    columns[index]?.secondary ? styles.secondary : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
