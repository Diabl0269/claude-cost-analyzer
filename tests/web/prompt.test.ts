import { describe, expect, it } from 'vitest';
import { cleanPromptText, commandOnlyPrompt } from '../../web/src/routes/session/transcript/prompt.js';

describe('cleanPromptText', () => {
  it('leaves plain text alone', () => {
    expect(cleanPromptText('Rename the helper in utils.ts')).toBe('Rename the helper in utils.ts');
  });

  it('renders a slash command the way it was typed', () => {
    expect(
      cleanPromptText('<command-name>/status</command-name>\n<command-message>status</command-message>\n<command-args>check the branch</command-args>'),
    ).toBe('/status check the branch');
  });

  it('keeps the text a command was sent with, under the command', () => {
    expect(cleanPromptText('<command-name>/review</command-name><command-args></command-args>\nlook at the parser')).toBe(
      '/review\n\nlook at the parser',
    );
  });

  it('drops a system reminder the user never typed', () => {
    expect(cleanPromptText('Fix the test<system-reminder>be careful</system-reminder>')).toBe('Fix the test');
  });
});

describe('commandOnlyPrompt', () => {
  it('names a prompt that was nothing but a command', () => {
    expect(commandOnlyPrompt('<command-name>/model</command-name><command-message>model</command-message><command-args></command-args>')).toBe(
      '/model',
    );
    expect(commandOnlyPrompt('<command-name>/effort</command-name><command-args>high</command-args>')).toBe('/effort high');
  });

  it('returns null when the prompt says anything else', () => {
    expect(commandOnlyPrompt('<command-name>/review</command-name>\nlook at the parser')).toBeNull();
    expect(commandOnlyPrompt('Rename the helper in utils.ts')).toBeNull();
  });

  it('ignores a system reminder when deciding', () => {
    expect(
      commandOnlyPrompt('<command-name>/model</command-name><command-args></command-args><system-reminder>x</system-reminder>'),
    ).toBe('/model');
  });
});
