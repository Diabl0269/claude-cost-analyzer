import { describe, expect, it } from 'vitest';
import {
  attachmentTypeLabel,
  hookDisplayName,
  isConnectorId,
  isSyntheticPriceRow,
  isUnnamedHook,
  mcpServerLabel,
  shortToolLabel,
  splitMcpName,
} from '../../web/src/lib/tools.js';

describe('MCP tool names', () => {
  it('splits `mcp__server__tool` and leaves built-ins alone', () => {
    expect(splitMcpName('mcp__grafana-sso__query_prometheus')).toEqual({
      server: 'grafana-sso',
      tool: 'query_prometheus',
    });
    expect(splitMcpName('Bash')).toBeNull();
    expect(splitMcpName('mcp__')).toBeNull();
  });

  it('keeps a tool name that itself contains underscores whole', () => {
    expect(splitMcpName('mcp__datadog__search_datadog_logs')?.tool).toBe('search_datadog_logs');
  });

  it('recognises a claude.ai connector id', () => {
    expect(isConnectorId('2e5498bf-ea22-4c0f-b0b9-f9f0020f2e11')).toBe(true);
    expect(isConnectorId('grafana-sso')).toBe(false);
  });

  it('labels a named server with its name and a connector with a short id', () => {
    expect(mcpServerLabel('grafana-sso')).toBe('grafana-sso');
    expect(mcpServerLabel('2e5498bf-ea22-4c0f-b0b9-f9f0020f2e11')).toBe('Connector 2e5498bf');
  });

  /**
   * The reason the connector case is turned around: a receipt row truncates, so leading with a
   * UUID left the reader with an id and no tool. The tool has to come first.
   */
  it('leads with the tool when the server is only an id', () => {
    expect(shortToolLabel('mcp__grafana-sso__query_prometheus')).toBe('grafana-sso/query_prometheus');
    expect(shortToolLabel('mcp__2e5498bf-ea22-4c0f-b0b9-f9f0020f2e11__slack_send_message')).toBe(
      'slack_send_message (connector)',
    );
    expect(shortToolLabel('Bash')).toBe('Bash');
  });
});

describe('harness attachment names', () => {
  it('names the types the audit found printing as identifiers', () => {
    expect(attachmentTypeLabel('task_reminder')).toBe('Task reminder');
    expect(attachmentTypeLabel('total_tokens_reminder')).toBe('Token-budget reminder');
    expect(attachmentTypeLabel('skill_listing')).toBe('Skill listing');
    expect(attachmentTypeLabel('edited_text_file')).toBe('Edited file');
    expect(attachmentTypeLabel('file')).toBe('File');
    expect(attachmentTypeLabel('sandbox_instructions')).toBe('Sandbox instructions');
    expect(attachmentTypeLabel('mcp_instructions_delta')).toBe('MCP instructions update');
    expect(attachmentTypeLabel('read_truncation_notice')).toBe('Read truncation notice');
    expect(attachmentTypeLabel('agent_listing_delta')).toBe('Agent listing update');
  });

  it('title-cases an attachment type it has never seen instead of printing the id', () => {
    expect(attachmentTypeLabel('some_future_thing')).toBe('Some future thing');
    expect(attachmentTypeLabel('')).toBe('');
  });
});

describe('hook names', () => {
  it('names a hook that arrived without one after its event', () => {
    expect(hookDisplayName({ hookName: '(unnamed)', hookEvent: 'Stop' })).toBe('Stop hook');
    expect(hookDisplayName({ hookName: '', hookEvent: 'PostToolUse' })).toBe('PostToolUse hook');
    expect(hookDisplayName({ hookName: '(unnamed)' })).toBe('Unnamed hook');
  });

  it('prefers a real name, then the index’s own label', () => {
    expect(hookDisplayName({ hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse' })).toBe('PreToolUse:Bash');
    expect(hookDisplayName({ hookName: '(unnamed)', hookEvent: 'Stop', displayName: 'Stop · notify.sh' })).toBe(
      'Stop · notify.sh',
    );
  });

  it('knows which rows the index could not name', () => {
    expect(isUnnamedHook('(unnamed)')).toBe(true);
    expect(isUnnamedHook('  ')).toBe(true);
    expect(isUnnamedHook('SessionStart:startup')).toBe(false);
  });
});

describe('the synthetic pricing sentinel', () => {
  it('recognises the row the editor must not show', () => {
    expect(isSyntheticPriceRow({ key: 'synthetic', match: ['<synthetic>'] })).toBe(true);
    expect(isSyntheticPriceRow({ key: 'other', match: ['<synthetic:'] })).toBe(true);
    expect(isSyntheticPriceRow({ key: 'opus-5', match: ['claude-opus-5'] })).toBe(false);
    expect(isSyntheticPriceRow({ key: 'custom', match: [] })).toBe(false);
  });
});
