/**
 * Names, not identifiers — the humanizers the tables and receipts share.
 *
 * Tools that came from an MCP server, the harness's own attachment types and a hook that
 * arrived without a name all reach the UI as raw ids. Every one of them is turned into
 * something a reader can use here, once, so two pages cannot disagree about what to call it.
 *
 * A tool arrives as `mcp__<server>__<tool>`, and for a claude.ai connector the `<server>` half
 * is a UUID rather than a name (SPEC §3.5). Leading with that id is the difference between a
 * row that says `slack_send_message (connector)` and one that says `2e5498bf-ea22-4c0f-b0b9-…`
 * and nothing else, because every label in a receipt or a rail truncates.
 */

const MCP_NAME = /^mcp__([^_].*?)__(.+)$/;
const UUID_SERVER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface McpParts {
  server: string;
  tool: string;
}

/** The server and tool halves of an MCP tool name, or null for a built-in tool. */
export function splitMcpName(name: string): McpParts | null {
  const match = MCP_NAME.exec(name);
  if (!match) return null;
  return { server: match[1] ?? '', tool: match[2] ?? '' };
}

/** True when the server half is a connector id rather than a name a reader would recognise. */
export function isConnectorId(server: string): boolean {
  return UUID_SERVER.test(server);
}

/** What to call an MCP server on screen: its name, or `Connector 2e5498bf` for a bare id. */
export function mcpServerLabel(server: string): string {
  return isConnectorId(server) ? `Connector ${server.slice(0, 8)}` : server;
}

/**
 * `mcp__grafana-sso__query_prometheus` → `grafana-sso/query_prometheus`; a connector's tool
 * leads with the tool, because its server half carries no meaning.
 */
export function shortToolLabel(name: string): string {
  const parts = splitMcpName(name);
  if (!parts) return name;
  return isConnectorId(parts.server) ? `${parts.tool} (connector)` : `${parts.server}/${parts.tool}`;
}

/**
 * Names for the things Claude Code attaches to a conversation by itself.
 *
 * The index stores the harness's own identifiers (`task_reminder`, `total_tokens_reminder`),
 * because that is what the transcript says and the exports must stay joinable to it. A reader
 * should never have to know them: the table prints the name and keeps the id as the tooltip.
 */
const ATTACHMENT_LABELS: Record<string, string> = {
  agent_listing_delta: 'Agent listing update',
  compact_summary: 'Compaction summary',
  date_change: 'Date change notice',
  deferred_tools_delta: 'Deferred tool listing update',
  diagnostics: 'Editor diagnostics',
  edited_text_file: 'Edited file',
  file: 'File',
  image: 'Image',
  invoked_skills: 'Invoked skill',
  mcp_instructions_delta: 'MCP instructions update',
  mcp_resource: 'MCP resource',
  nested_memory: 'Nested memory file',
  new_directory: 'New directory notice',
  open_file_in_ide: 'File open in the editor',
  plan_mode: 'Plan-mode instructions',
  queued_command: 'Queued command',
  read_truncation_notice: 'Read truncation notice',
  sandbox_instructions: 'Sandbox instructions',
  selected_lines_in_ide: 'Editor selection',
  skill_listing: 'Skill listing',
  System_reminder: 'System reminder',
  system_reminder: 'System reminder',
  task_reminder: 'Task reminder',
  todo: 'Todo list',
  total_tokens_reminder: 'Token-budget reminder',
  ultramemory: 'Memory file',
  workflow_keyword_request: 'Workflow keyword request',
};

/**
 * `task_reminder` → `Task reminder`. An unmapped id is title-cased rather than printed raw, so
 * a new attachment type from a future Claude Code still reads as a name.
 */
export function attachmentTypeLabel(type: string): string {
  const known = ATTACHMENT_LABELS[type];
  if (known) return known;
  const words = type.replace(/[_-]+/g, ' ').trim();
  if (words === '') return type;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The placeholder the index writes when a transcript reported no hook name. */
const UNNAMED_HOOK = '(unnamed)';

export interface HookNameParts {
  hookName: string;
  hookEvent?: string;
  /** the server's own presentable label, when this build of the index provides one */
  displayName?: string;
}

/**
 * What to call a hook on screen. A hook that arrived without a name is its event —
 * `(unnamed) · Stop` becomes `Stop hook`, which is what the reader would call it anyway.
 */
export function hookDisplayName({ hookName, hookEvent, displayName }: HookNameParts): string {
  const named = hookName.trim() !== '' && hookName !== UNNAMED_HOOK;
  if (named) return hookName;
  if (displayName && displayName.trim() !== '' && displayName !== UNNAMED_HOOK) return displayName;
  return hookEvent && hookEvent.trim() !== '' ? `${hookEvent} hook` : 'Unnamed hook';
}

/** True when the row's own name told us nothing and {@link hookDisplayName} named it instead. */
export function isUnnamedHook(hookName: string): boolean {
  return hookName.trim() === '' || hookName === UNNAMED_HOOK;
}

/** The sentinel row the pricing table carries for unpriced synthetic models (SPEC §5.2). */
export function isSyntheticPriceRow(model: { key: string; match: string[] }): boolean {
  return model.key === 'synthetic' || (model.match.length > 0 && model.match.every((prefix) => prefix.startsWith('<')));
}
