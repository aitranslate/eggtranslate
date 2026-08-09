import { describe, it, expect } from 'vitest';
import {
  isSimplifiedChineseTarget,
  maybeSimplifyChinese,
  SIMPLIFIED_CHINESE_TARGET,
} from '../chineseScript';

describe('chineseScript', () => {
  it('detects simplified Chinese target only', () => {
    expect(isSimplifiedChineseTarget(SIMPLIFIED_CHINESE_TARGET)).toBe(true);
    expect(isSimplifiedChineseTarget(' 简体中文 ')).toBe(true);
    expect(isSimplifiedChineseTarget('繁体中文')).toBe(false);
    expect(isSimplifiedChineseTarget('English')).toBe(false);
    expect(isSimplifiedChineseTarget('')).toBe(false);
    expect(isSimplifiedChineseTarget(undefined)).toBe(false);
  });

  it('converts traditional glyphs when target is simplified', () => {
    // 會→会、語→语、國→国
    expect(maybeSimplifyChinese('我會說漢語', '简体中文')).toBe('我会说汉语');
    expect(maybeSimplifyChinese('這個國家', '简体中文')).toBe('这个国家');
  });

  it('does not convert for traditional Chinese target', () => {
    const trad = '我會說漢語';
    expect(maybeSimplifyChinese(trad, '繁体中文')).toBe(trad);
  });

  it('does not convert for non-Chinese targets', () => {
    const mixed = '我會 go home';
    expect(maybeSimplifyChinese(mixed, 'English')).toBe(mixed);
  });

  it('passes through empty / already simplified', () => {
    expect(maybeSimplifyChinese('', '简体中文')).toBe('');
    expect(maybeSimplifyChinese('我会说汉语', '简体中文')).toBe('我会说汉语');
  });
});
