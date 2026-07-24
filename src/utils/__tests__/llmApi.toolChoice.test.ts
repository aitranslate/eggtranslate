import { describe, it, expect } from 'vitest';
import { isToolChoiceRejectedMessage } from '../llmApi';

describe('isToolChoiceRejectedMessage', () => {
  it('matches explicit tool_choice rejections', () => {
    expect(isToolChoiceRejectedMessage("Invalid value for 'tool_choice'")).toBe(
      true
    );
    expect(
      isToolChoiceRejectedMessage('tool choice is not supported for this model')
    ).toBe(true);
    expect(
      isToolChoiceRejectedMessage('Forced function calling is not supported')
    ).toBe(true);
  });

  it('does not treat generic 400 / context errors as tool_choice failures', () => {
    expect(isToolChoiceRejectedMessage('HTTP 400')).toBe(false);
    expect(isToolChoiceRejectedMessage('context length exceeded')).toBe(false);
    expect(isToolChoiceRejectedMessage('model not found')).toBe(false);
    expect(isToolChoiceRejectedMessage('unsupported model')).toBe(false);
    expect(isToolChoiceRejectedMessage('')).toBe(false);
  });
});
