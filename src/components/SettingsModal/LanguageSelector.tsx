import React, { useMemo } from 'react';
import { LANGUAGE_OPTIONS } from '@/constants/languages';

interface LanguageSelectorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** 历史脏数据：en / zh-cn 等 → LANGUAGE_OPTIONS.value */
export function normalizeLangValue(raw: string): string {
  if (!raw) return raw;
  if (LANGUAGE_OPTIONS.some((l) => l.value === raw)) return raw;
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    en: 'English',
    eng: 'English',
    english: 'English',
    zh: '简体中文',
    'zh-cn': '简体中文',
    'zh-hans': '简体中文',
    'zh-tw': '繁体中文',
    'zh-hant': '繁体中文',
    ja: 'Japanese',
    jp: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    ru: 'Russian',
  };
  return map[key] ?? raw;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  label,
  value,
  onChange,
  className = '',
}) => {
  const selectValue = useMemo(() => normalizeLangValue(value), [value]);

  return (
    <div className={className}>
      <label className="block text-[13px] font-medium text-[var(--wb-text-2,#6e6e73)] mb-1.5">
        {label}
      </label>
      <select
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 px-3 rounded-[8px] text-[14px] font-medium
          bg-[var(--wb-panel,#fff)] text-[var(--wb-text,#1d1d1f)]
          border border-[var(--wb-border,#e3e5ea)]
          hover:border-[var(--wb-border-strong,#d2d5db)]
          focus:outline-none focus:border-[var(--wb-brand,#0071e3)]
          focus:ring-2 focus:ring-[var(--wb-brand-soft,rgba(0,113,227,0.12))]
          focus:bg-[var(--wb-panel,#fff)]
          transition-[border-color,box-shadow]"
      >
        {LANGUAGE_OPTIONS.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </select>
    </div>
  );
};
