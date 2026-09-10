/**
 * Display formatting for the web app.
 *
 * Money, token and model-label rules live in `core/pricing/format.ts` — that module is pure
 * and browser-safe, and the server uses it for CSV/JSON exports. This file re-exports it and
 * only adds:
 *   - null/undefined tolerance (API fields are frequently nullable),
 *   - an optional display currency (SPEC §8.4 settings) applied on top of the core rules,
 *   - web-only helpers with no server counterpart (relative time, local ISO days, truncate).
 *
 * The import is relative rather than `@core/...` on purpose: this file is type-checked by both
 * `tsconfig.web.json` (Bundler resolution, `@core` alias) and `tsconfig.tests.json`
 * (NodeNext, no alias), so only an explicit `.js` relative specifier satisfies both.
 */
import {
  formatDate as coreFormatDate,
  formatDateTime as coreFormatDateTime,
  formatDuration as coreFormatDuration,
  formatMoney as coreFormatMoney,
  formatMonthKey as coreFormatMonthKey,
  formatTime as coreFormatTime,
  formatTokens as coreFormatTokens,
  formatTokensFull as coreFormatTokensFull,
  type MoneyOptions,
} from '../../../core/pricing/format.js';

export type { MoneyOptions } from '../../../core/pricing/format.js';

export {
  escapeHtml,
  formatMoneyCompact,
  formatModelLabel,
  formatTokensFull,
} from '../../../core/pricing/format.js';

export interface CurrencyDisplay {
  /** ISO 4217 code, e.g. "USD", "EUR" */
  code: string;
  /** multiplier applied to USD amounts */
  rate: number;
}

const USD: CurrencyDisplay = { code: 'USD', rate: 1 };

/** Shown wherever a number is unknown rather than zero. */
export const EM_DASH = '—';

const symbols = new Map<string, string>([['USD', '$']]);

function symbolFor(currency: CurrencyDisplay): string {
  const cached = symbols.get(currency.code);
  if (cached !== undefined) return cached;
  let symbol = `${currency.code} `;
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.code }).formatToParts(1);
    symbol = parts.find((part) => part.type === 'currency')?.value ?? symbol;
  } catch {
    /* an unknown code falls back to the code itself */
  }
  symbols.set(currency.code, symbol);
  return symbol;
}

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** Applies the display currency to a string core produced in USD. */
function inCurrency(text: string, currency: CurrencyDisplay): string {
  return currency.code === 'USD' ? text : text.replace('$', symbolFor(currency));
}

/**
 * Money for display: 2 decimals normally, 4 decimals under a cent, `<$0.0001` for a
 * non-zero amount too small to show. The digit rules come from `core/pricing/format`, and
 * `opts` is handed to it unchanged — a fixed `decimals` or a `signed` delta in the display
 * currency needs no second formatter (and no second currency-symbol table).
 */
export function formatMoney(
  usd: number | null | undefined,
  currency: CurrencyDisplay = USD,
  opts?: MoneyOptions,
): string {
  if (!isNumber(usd)) return EM_DASH;
  return inCurrency(coreFormatMoney(usd * currency.rate, opts), currency);
}

/** Full precision, for `title` attributes and copy-to-clipboard. */
export function formatMoneyExact(usd: number | null | undefined, currency: CurrencyDisplay = USD): string {
  return formatMoney(usd, currency, { decimals: 6 });
}

/** Signed money, used for deltas (`+$1.20`, `-$0.0042`). */
export function formatMoneyDelta(usd: number | null | undefined, currency: CurrencyDisplay = USD): string {
  return formatMoney(usd, currency, { signed: true });
}

/** Compact token counts: `843`, `12.5k`, `1.2M`. */
export function formatTokens(tokens: number | null | undefined): string {
  return isNumber(tokens) ? coreFormatTokens(tokens) : EM_DASH;
}

/** Grouped integer, for `title` attributes (`8,942,006`). */
export function formatTokensExact(tokens: number | null | undefined): string {
  return isNumber(tokens) ? coreFormatTokensFull(tokens).replace(/ tokens$/, '') : EM_DASH;
}

const counter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Grouped integer for non-token counts (requests, sessions, calls). */
export function formatCount(count: number | null | undefined): string {
  return isNumber(count) ? counter.format(Math.round(count)) : EM_DASH;
}

const percenter = new Map<number, Intl.NumberFormat>();

function percentFormatter(digits: number): Intl.NumberFormat {
  let formatter = percenter.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    percenter.set(digits, formatter);
  }
  return formatter;
}

/**
 * `fraction` is 0–1. Whole percents above 10% (`94%`), one decimal below (`4.2%`),
 * and `<0.1%` for a non-zero share too small to round to one decimal — the UI shows a lot
 * of shares and `0.0%` for a real value reads as "nothing".
 */
export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (!isNumber(fraction)) return EM_DASH;
  const pct = fraction * 100;
  if (pct === 0) return '0%';
  if (Math.abs(pct) < 0.1) return '<0.1%';
  return `${percentFormatter(Math.abs(pct) >= 10 ? 0 : digits).format(pct)}%`;
}

/**
 * `840ms`, `4.2s`, `42s`, `12m 30s`, `3h 07m`, `2d 4h`. Zero-padded minutes and seconds so
 * durations stay column-aligned in a ledger; the core variant does not pad (CSV/prose).
 *
 * Everything is rounded to the precision that will actually be printed **before** the value is
 * split into units. Rounding after the split lets a remainder carry into an impossible digit —
 * 239_600 ms used to print `3m 60s` and 3_599_600 ms `59m 60s`.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!isNumber(ms)) return EM_DASH;
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(abs)}ms`;
  // Under ten seconds the display carries one decimal, so round to tenths first: 9_960 ms is
  // `10.0s` at that precision, which belongs in the whole-seconds branch instead.
  const tenths = Math.round(abs / 100) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)}s`;
  const totalSeconds = Math.round(abs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`;
}

/** `formatDuration` without padding, matching `core/pricing/format`. */
export const formatDurationPlain = coreFormatDuration;

export type DateStyle = 'date' | 'datetime' | 'time' | 'day' | 'month' | 'iso';

const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(input: string | number | Date | null | undefined, style: DateStyle = 'date'): string {
  const date = toDate(input);
  if (!date) return EM_DASH;
  switch (style) {
    case 'iso':
      return date.toISOString();
    case 'time':
      return coreFormatTime(date);
    case 'datetime':
      return coreFormatDateTime(date);
    case 'day':
      return dayFmt.format(date);
    case 'month':
      return coreFormatMonthKey(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    case 'date':
      return coreFormatDate(date);
  }
}

/** `just now`, `4m ago`, `3h ago`, `yesterday`, `5d ago`, then an absolute date. */
export function relativeTime(input: string | number | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(input);
  if (!date) return EM_DASH;
  const deltaMs = now.getTime() - date.getTime();
  const future = deltaMs < 0;
  const abs = Math.abs(deltaMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < 45_000) return 'just now';
  if (abs < hour) return suffix(`${Math.round(abs / minute)}m`, future);
  if (abs < day) return suffix(`${Math.round(abs / hour)}h`, future);
  if (abs < 2 * day) return future ? 'tomorrow' : 'yesterday';
  if (abs < 7 * day) return suffix(`${Math.round(abs / day)}d`, future);
  return formatDate(date, now.getFullYear() === date.getFullYear() ? 'day' : 'date');
}

function suffix(text: string, future: boolean): string {
  return future ? `in ${text}` : `${text} ago`;
}

/** `YYYY-MM-DD` in local time (the shape every range query uses). */
export function toIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Parses `YYYY-MM-DD` as local midnight (never UTC — ranges are local per SPEC §7.2). */
export function fromIsoDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDayLabel(day: string): string {
  const date = fromIsoDay(day);
  return date ? formatDate(date, 'day') : day;
}

/**
 * Truncates from the middle, keeping both ends. For a filesystem path the two ends are the
 * informative parts — `/Users/…/projects` says more than `/Users/dev/Documents/Doc…`.
 */
export function truncateMiddle(text: string, max: number): string {
  if (max <= 1 || text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return tail > 0 ? `${text.slice(0, head)}…${text.slice(text.length - tail)}` : `${text.slice(0, head)}…`;
}

/** Truncates on a word boundary and appends an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
