/**
 * Reading a user prompt out of the shapes Claude Code writes it in.
 *
 * A slash command reaches the transcript as `<command-name>` / `<command-args>` tags around the
 * text the model actually saw, and a prompt can carry a `<system-reminder>` block the user never
 * typed. Both are stripped here so the transcript shows what was typed (SPEC §4).
 *
 * Kept free of imports so it can be unit-tested directly.
 */

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const COMMAND_TAGS = /<command-(name|message|args|contents)>[\s\S]*?<\/command-\1>/g;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

interface Parsed {
  command: string | null;
  rest: string;
}

function parse(text: string): Parsed {
  const withoutReminders = text.replace(SYSTEM_REMINDER, '').trim();
  const name = COMMAND_NAME.exec(withoutReminders)?.[1]?.trim();
  if (!name) return { command: null, rest: withoutReminders };
  const args = COMMAND_ARGS.exec(withoutReminders)?.[1]?.trim() ?? '';
  return {
    command: `${name}${args ? ` ${args}` : ''}`,
    rest: withoutReminders.replace(COMMAND_TAGS, '').trim(),
  };
}

/** The prompt as it was typed: `/model sonnet`, or the plain text, or both. */
export function cleanPromptText(text: string): string {
  const { command, rest } = parse(text);
  if (command === null) return rest;
  return rest ? `${command}\n\n${rest}` : command;
}

/**
 * The slash command, when the prompt was nothing but one (`/model`, `/effort high`). Those are
 * settings changes, not conversation: a full prompt card for each one buries the turns that
 * actually cost money. Null when the prompt carries text of its own as well.
 */
export function commandOnlyPrompt(text: string): string | null {
  const { command, rest } = parse(text);
  return command !== null && !rest ? command : null;
}
