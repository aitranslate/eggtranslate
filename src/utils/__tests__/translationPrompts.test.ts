import { describe, it, expect } from 'vitest';
import { generateSharedPrompt, generateDirectPrompt } from '../translationPrompts';

describe('generateSharedPrompt', () => {
  it('空输入不产出空标签', () => {
    expect(generateSharedPrompt('', '', '')).toBe('');
  });

  it('带上已确定译法和术语', () => {
    const out = generateSharedPrompt(
      'Hello → 你好',
      'Bye',
      'Apple -> 苹果',
      'John → 约翰'
    );
    expect(out).toContain('<previous_content>\nHello → 你好\n</previous_content>');
    expect(out).toContain('<subsequent_content>\nBye\n</subsequent_content>');
    expect(out).toContain('Established renderings');
    expect(out).toContain('John → 约翰');
    expect(out).toContain('Apple -> 苹果');
  });
});

describe('generateDirectPrompt', () => {
  it('写明只译 subtitles、参考区禁止写入 JSON', () => {
    const prompt = generateDirectPrompt(
      'Hello\nWorld',
      generateSharedPrompt('Prev → 前', '', ''),
      'English',
      '简体中文'
    );
    expect(prompt).toContain('Translate ONLY the lines inside <subtitles>');
    expect(prompt).toContain('REFERENCE ONLY');
    expect(prompt).toContain('Never copy them into any "direct" field');
    expect(prompt).toContain('<register>');
    expect(prompt).toContain('"1"');
    expect(prompt).toContain('Hello');
  });
});
