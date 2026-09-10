import { mcpServerLabel } from '@/lib/tools';
import styles from './toolbits.module.css';

/** `mcp__server__tool` reads as one long identifier; the server prefix is set back visually. */
export function ToolName({ name, mcpServer }: { name: string; mcpServer?: string }) {
  if (!mcpServer) return <span className={styles.name}>{name}</span>;
  const tool = name.startsWith(`mcp__${mcpServer}__`) ? name.slice(`mcp__${mcpServer}__`.length) : name;
  return (
    <span className={styles.name} title={name}>
      <span className={styles.server}>{mcpServerLabel(mcpServer)}</span>
      <span className={styles.sep}>/</span>
      {tool}
    </span>
  );
}

/** Where a seq lives: the main transcript, or the subagent's own. */
export function transcriptHref(sessionId: string, agentId: string | null, seq: number): string {
  const base = `/sessions/${encodeURIComponent(sessionId)}`;
  return agentId
    ? `${base}/agents/${encodeURIComponent(agentId)}?seq=${seq}`
    : `${base}/transcript?seq=${seq}`;
}
