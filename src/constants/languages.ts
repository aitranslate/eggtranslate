/**
 * 支持的语言列表
 * 用于翻译设置中的源语言和目标语言选择
 */

export interface LanguageOption {
  value: string;
  label: string;
  nativeName: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: 'English', label: '英语', nativeName: 'English' },
  { value: '简体中文', label: '中文（简体）', nativeName: 'Simplified Chinese' },
  { value: '繁体中文', label: '中文（繁体）', nativeName: 'Traditional Chinese' },
  { value: 'Japanese', label: '日语', nativeName: 'Japanese' },
  { value: 'Korean', label: '韩语', nativeName: 'Korean' },
  { value: 'French', label: '法语', nativeName: 'French' },
  { value: 'German', label: '德语', nativeName: 'German' },
  { value: 'Spanish', label: '西班牙语', nativeName: 'Spanish' },
  { value: 'Italian', label: '意大利语', nativeName: 'Italian' },
  { value: 'Portuguese', label: '葡萄牙语', nativeName: 'Portuguese' },
  { value: 'Russian', label: '俄语', nativeName: 'Russian' },
  { value: 'Arabic', label: '阿拉伯语', nativeName: 'Arabic' },
  { value: 'Thai', label: '泰语', nativeName: 'Thai' },
  { value: 'Vietnamese', label: '越南语', nativeName: 'Vietnamese' },
  { value: 'Indonesian', label: '印尼语', nativeName: 'Indonesian' },
  { value: 'Hindi', label: '印地语', nativeName: 'Hindi' },
  { value: 'Dutch', label: '荷兰语', nativeName: 'Dutch' },
  { value: 'Swedish', label: '瑞典语', nativeName: 'Swedish' },
  { value: 'Norwegian', label: '挪威语', nativeName: 'Norwegian' },
];
