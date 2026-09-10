/**
 * Names for the two things a session delegates to. Both arrive from the parser as identifiers,
 * and an identifier on its own is not a label a reader can use.
 */

/** `wf_18830d24-fec` → `Workflow run 18830d24-fec`. */
export function workflowRunLabel(runId: string): string {
  const short = runId.replace(/^wf_/, '');
  return `Workflow run ${short}`;
}

/**
 * What to call a subagent. `description` is the brief it was launched with, which says far more
 * than a type name every sibling shares ("workflow-subagent" six times over); the type is the
 * fallback for agents launched without one.
 */
export function agentLabel(agent: { description?: string | undefined; agentType?: string | undefined }): string {
  const description = agent.description?.trim();
  if (description) return description;
  return agent.agentType?.trim() || 'agent';
}
