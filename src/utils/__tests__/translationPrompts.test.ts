import { describe, it, expect } from 'vitest';
import { generateSharedPrompt, generateDirectPrompt } from '../translationPrompts';

describe('generateSharedPrompt', () => {
  it('空输入不产出空标签', () => {
    expect(generateSharedPrompt('', '', '')).toBe('');
  });

  it('带上前后文和术语', () => {
    const out = generateSharedPrompt(
      'Hello → 你好',
      'Bye',
      'Apple -> 苹果',
    );
    expect(out).toContain('<previous_content>\nHello → 你好\n</previous_content>');
    expect(out).toContain('<subsequent_content>\nBye\n</subsequent_content>');
    expect(out).not.toContain('Established renderings');
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

  it('默认走 generic（角色扮演式长模板）', () => {
    const prompt = generateDirectPrompt('A\nB', '', 'Chinese', 'English');
    expect(prompt).toContain('## Role');
    expect(prompt).not.toContain('"direct" 字段填入');
  });

  describe('translation-specialist 变体', () => {
    it('显式约束 origin 原样保留、direct 填译文', () => {
      const prompt = generateDirectPrompt(
        '我现在在天海酒吧。\n十分钟，二十公里呢。',
        '',
        '中文',
        '英语',
        'translation-specialist'
      );
      // 槽位语义必须写成可执行的硬约束，否则纯翻译模型会把译文填进 origin
      expect(prompt).toContain('"origin" 字段必须原样保留');
      expect(prompt).toContain('"direct" 字段填入对应行');
      expect(prompt).toContain('键名与行号不得改变');
      // 不使用通用模型的角色扮演模板
      expect(prompt).not.toContain('## Role');
      expect(prompt).not.toContain('Netflix subtitle translator');
    });

    it('沿用源语言与目标语言的实际名称', () => {
      const prompt = generateDirectPrompt('A', '', '日语', '简体中文', 'translation-specialist');
      expect(prompt).toContain('从日语翻译成简体中文');
      expect(prompt).toContain('原样保留日语原文');
      expect(prompt).toContain('对应行的简体中文译文');
    });

    it('前后文/术语仍带上但降级为参考区', () => {
      const prompt = generateDirectPrompt(
        'A\nB',
        generateSharedPrompt('Prev → 前', 'Next', '苹果 -> Apple'),
        '中文',
        '英语',
        'translation-specialist'
      );
      expect(prompt).toContain('【参考（仅用于消歧，禁止翻译、禁止写入任何字段）】');
      expect(prompt).toContain('Prev → 前');
      expect(prompt).toContain('苹果 -> Apple');
      // 参考内容不得混进待译的 <source> 块
      expect(prompt.indexOf('【source】')).toBeLessThan(prompt.indexOf('A\nB'));
    });

    it('行号与行数一一对应', () => {
      const prompt = generateDirectPrompt(
        '一\n二\n三',
        '',
        '中文',
        '英语',
        'translation-specialist'
      );
      for (const key of ['"1"', '"2"', '"3"']) {
        expect(prompt).toContain(key);
      }
      expect(prompt).not.toContain('"4"');
    });
  });
});
