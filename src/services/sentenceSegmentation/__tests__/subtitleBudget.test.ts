// 译文字数预算：CPS × 该条时长 = 模型该写的上限。
import { describe, expect, it } from 'vitest';
import { cpsMaxForLanguage, maxCharsForCue } from '../subtitleBudget';
import { generateDirectPrompt } from '@/utils/translationPrompts';

describe('cpsMaxForLanguage', () => {
  it('按 Netflix TTSG 给目标语言定 CPS', () => {
    expect(cpsMaxForLanguage('简体中文')).toBe(9);
    expect(cpsMaxForLanguage('繁体中文')).toBe(9);
    expect(cpsMaxForLanguage('日语')).toBe(4);
    expect(cpsMaxForLanguage('韩语')).toBe(12);
    expect(cpsMaxForLanguage('English')).toBe(20);
    expect(cpsMaxForLanguage('Thai')).toBe(17);
    expect(cpsMaxForLanguage('')).toBe(17);
  });
});

describe('maxCharsForCue', () => {
  it('时长 × CPS，向下取整，最少 4 个字符', () => {
    expect(maxCharsForCue('简体中文', 2)).toBe(18);
    expect(maxCharsForCue('English', 2)).toBe(40);
    expect(maxCharsForCue('简体中文', 0.2)).toBe(4);
    expect(maxCharsForCue('English', 0)).toBe(0);
  });
});

describe('提示词里的字数上限', () => {
  const lines = 'hello there\nhow are you';

  it('逐条预算写进 generic 模板', () => {
    const prompt = generateDirectPrompt(lines, '', 'English', '简体中文', 'generic', [9, 18]);
    expect(prompt).toContain('字数上限');
    expect(prompt).toContain('1:9');
    expect(prompt).toContain('2:18');
  });

  it('预算一致时压成一句，不逐条罗列', () => {
    const prompt = generateDirectPrompt(lines, '', 'English', '简体中文', 'generic', [12, 12]);
    expect(prompt).toContain('每条译文不超过 12 个字符');
    expect(prompt).not.toContain('1:12');
  });

  it('没有预算时不出现该段落', () => {
    const prompt = generateDirectPrompt(lines, '', 'English', '简体中文', 'generic');
    expect(prompt).not.toContain('字数上限');
  });

  it('纯翻译模型模板也带预算', () => {
    const prompt = generateDirectPrompt(lines, '', 'English', '简体中文', 'translation-specialist', [9, 18]);
    expect(prompt).toContain('字数上限');
    expect(prompt).toContain('1:9');
  });
});
