import type { ToolAnalyticsRow } from '@core/types';
import { mcpServerLabel } from '@/lib/tools';

/** One line of the tools table, whether it is a single tool or a whole MCP server. */
export interface ToolRow {
  key: string;
  name: string;
  /** MCP server for a single tool; undefined for built-ins and for grouped rows */
  server?: string;
  /** how many distinct tools this row covers (1 unless grouped) */
  tools: number;
  calls: number;
  errors: number;
  sessions: number;
  avgResultChars: number;
  totalResultTokens: number;
  genCost: number;
  ingestCost: number;
  carryCost: number;
  totalCost: number;
  childCost: number;
}

export const BUILT_IN_GROUP = 'Built-in tools';

/** The tool's bare name without the `mcp__<server>__` prefix. */
export function shortToolName(row: ToolAnalyticsRow): string {
  if (!row.mcpServer) return row.name;
  const prefix = `mcp__${row.mcpServer}__`;
  return row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name;
}

function toRow(row: ToolAnalyticsRow): ToolRow {
  return {
    key: row.name,
    name: shortToolName(row),
    server: row.mcpServer,
    tools: 1,
    calls: row.calls,
    errors: row.errors,
    sessions: row.sessions,
    avgResultChars: row.avgResultChars,
    totalResultTokens: row.totalResultTokens,
    genCost: row.genCost,
    ingestCost: row.ingestCost,
    carryCost: row.carryCost,
    totalCost: row.totalCost,
    childCost: row.childCost,
  };
}

/**
 * Collapses the flat tool list onto one row per MCP server, with every built-in tool in a
 * single row. `sessions` is deliberately dropped when grouping: a session that used two tools
 * from the same server would be counted twice, and the page hides the column instead of lying.
 */
function group(rows: ToolAnalyticsRow[]): ToolRow[] {
  const groups = new Map<string, ToolRow>();
  for (const row of rows) {
    const key = row.mcpServer ?? BUILT_IN_GROUP;
    const existing = groups.get(key);
    const target =
      existing ??
      {
        key,
        name: row.mcpServer ? mcpServerLabel(row.mcpServer) : key,
        server: row.mcpServer,
        tools: 0,
        calls: 0,
        errors: 0,
        sessions: 0,
        avgResultChars: 0,
        totalResultTokens: 0,
        genCost: 0,
        ingestCost: 0,
        carryCost: 0,
        totalCost: 0,
        childCost: 0,
      };
    target.tools += 1;
    target.calls += row.calls;
    target.errors += row.errors;
    // Weighted by calls so the group average is the average result, not the average of averages.
    target.avgResultChars += row.avgResultChars * row.calls;
    target.totalResultTokens += row.totalResultTokens;
    target.genCost += row.genCost;
    target.ingestCost += row.ingestCost;
    target.carryCost += row.carryCost;
    target.totalCost += row.totalCost;
    target.childCost += row.childCost;
    groups.set(key, target);
  }
  for (const row of groups.values()) {
    row.avgResultChars = row.calls > 0 ? row.avgResultChars / row.calls : 0;
  }
  return [...groups.values()];
}

export type ToolGrouping = 'tool' | 'server';

/** Filters by a case-insensitive substring of the tool or server name, then groups. */
export function buildToolRows(rows: ToolAnalyticsRow[], filter: string, grouping: ToolGrouping): ToolRow[] {
  const needle = filter.trim().toLowerCase();
  const matched = needle
    ? rows.filter((row) => row.name.toLowerCase().includes(needle) || (row.mcpServer ?? '').toLowerCase().includes(needle))
    : rows;
  return grouping === 'server' ? group(matched) : matched.map(toRow);
}
