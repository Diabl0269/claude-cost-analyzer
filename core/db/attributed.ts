/**
 * Reads stored attribution facts back out and turns them into money using the per-transcript
 * price indexes. Nothing here re-derives token counts — those were fixed at index time.
 */
import type {
  AttributedCost,
  ContextEstMethod,
  ContextItemCost,
  ContextItemKind,
  EstMethod,
  InjectionCost,
  InjectionKind,
  ToolCallCost,
  ToolResultShape,
} from '../types.js';
import {
  contextItemCosts,
  priceItem,
  toolCallCosts,
  type ContextItemCostRow,
  type ToolCallCostRow,
} from '../cost/price-at-read.js';
import type { PriceIndexes } from './price-index.js';
import { bool, nullableNum, num, optStr, str, type Row } from './rows.js';

export const TOOL_CALL_COLUMNS = `sessionId, agentId, toolUseId, name, mcpServer, mcpTool, requestSeq, resultSeq,
  turnIndex, ts, inputChars, inputSummary, resultChars, resultShape, isError,
  childAgentId, childRunId, childModel, childDescription, genTokens, tokens, estMethod,
  ingestRequestSeq, lastCarrySeq`;

export const INJECTION_COLUMNS = `sessionId, agentId, seq, turnIndex, kind, name, chars, hookName, hookEvent,
  tokens, estMethod, ingestRequestSeq, lastCarrySeq`;

export const CONTEXT_ITEM_COLUMNS = `sessionId, agentId, seq, turnIndex, kind, tokens, estMethod,
  ingestRequestSeq, lastCarrySeq`;

function toolCallRow(row: Row): ToolCallCostRow {
  const agentId = str(row, 'agentId');
  const out: ToolCallCostRow = {
    toolUseId: str(row, 'toolUseId'),
    sessionId: str(row, 'sessionId'),
    agentId: agentId === '' ? null : agentId,
    name: str(row, 'name'),
    requestSeq: num(row, 'requestSeq'),
    turnIndex: num(row, 'turnIndex'),
    ts: str(row, 'ts'),
    inputSummary: str(row, 'inputSummary'),
    inputChars: num(row, 'inputChars'),
    resultChars: num(row, 'resultChars'),
    resultShape: str(row, 'resultShape') as ToolResultShape,
    isError: bool(row, 'isError'),
    genTokens: num(row, 'genTokens'),
    tokens: num(row, 'tokens'),
    estMethod: str(row, 'estMethod') as EstMethod,
    ingestRequestSeq: nullableNum(row, 'ingestRequestSeq'),
    lastCarrySeq: nullableNum(row, 'lastCarrySeq'),
  };
  const mcpServer = optStr(row, 'mcpServer');
  if (mcpServer) out.mcpServer = mcpServer;
  const resultSeq = nullableNum(row, 'resultSeq');
  if (resultSeq !== null) out.resultSeq = resultSeq;
  const childAgentId = optStr(row, 'childAgentId');
  if (childAgentId) out.childAgentId = childAgentId;
  const childRunId = optStr(row, 'childRunId');
  if (childRunId) out.childRunId = childRunId;
  const childModel = optStr(row, 'childModel');
  if (childModel) out.childModel = childModel;
  const childDescription = optStr(row, 'childDescription');
  if (childDescription) out.childDescription = childDescription;
  return out;
}

/** Prices tool-call rows. `sessionId` must be present on each row so the right index is used. */
export function toolCallCostsFrom(rows: readonly Row[], indexes: PriceIndexes): ToolCallCost[] {
  return toolCallCosts(rows.map(toolCallRow), (row) => indexes.get(row.sessionId ?? '', row.agentId ?? ''));
}

export function injectionCostsFrom(rows: readonly Row[], indexes: PriceIndexes): InjectionCost[] {
  return rows.map((row) => {
    const agentId = str(row, 'agentId');
    const index = indexes.get(str(row, 'sessionId'), agentId);
    const cost: AttributedCost = priceItem(
      {
        tokens: num(row, 'tokens'),
        estMethod: str(row, 'estMethod') as EstMethod,
        ingestRequestSeq: nullableNum(row, 'ingestRequestSeq'),
        lastCarrySeq: nullableNum(row, 'lastCarrySeq'),
      },
      index,
    );
    const out: InjectionCost = {
      seq: num(row, 'seq'),
      agentId: agentId === '' ? null : agentId,
      turnIndex: num(row, 'turnIndex'),
      kind: str(row, 'kind') as InjectionKind,
      name: str(row, 'name'),
      chars: num(row, 'chars'),
      cost,
    };
    const hookName = optStr(row, 'hookName');
    if (hookName) out.hookName = hookName;
    const hookEvent = optStr(row, 'hookEvent');
    if (hookEvent) out.hookEvent = hookEvent;
    return out;
  });
}

/** Prices the whole-context items (assistant history, baseline, post-compaction floor). */
export function contextItemCostsFrom(rows: readonly Row[], indexes: PriceIndexes): ContextItemCost[] {
  const mapped: ContextItemCostRow[] = rows.map((row) => {
    const agentId = str(row, 'agentId');
    return {
      sessionId: str(row, 'sessionId'),
      agentId: agentId === '' ? null : agentId,
      seq: num(row, 'seq'),
      turnIndex: num(row, 'turnIndex'),
      kind: str(row, 'kind') as ContextItemKind,
      tokens: num(row, 'tokens'),
      estMethod: str(row, 'estMethod') as ContextEstMethod,
      ingestRequestSeq: nullableNum(row, 'ingestRequestSeq'),
      lastCarrySeq: nullableNum(row, 'lastCarrySeq'),
    };
  });
  return contextItemCosts(mapped, (row) => indexes.get(row.sessionId ?? '', row.agentId ?? ''));
}
