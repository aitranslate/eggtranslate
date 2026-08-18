/**
 * 外观偏好：主题与音效。立即写入各自 store，不走翻译设置的保存草稿。
 */

import { useCallback } from 'react';
import { useThemeStore } from '@/stores/themeStore';
import { useSoundStore } from '@/stores/soundStore';
import { playAppSound } from '@/utils/appSound';

export function AppearanceSettings() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const soundEnabled = useSoundStore((s) => s.soundEnabled);
  const setSoundEnabled = useSoundStore((s) => s.setSoundEnabled);

  const handleSoundOn = useCallback(() => {
    setSoundEnabled(true);
    playAppSound('confirm');
  }, [setSoundEnabled]);

  return (
    <div className="wb-prefs-block">
      <div className="wb-prefs-row">
        <div className="wb-prefs-row-copy">
          <h4 className="wb-prefs-block-title">主题</h4>
          <p className="wb-prefs-row-desc">浅色或深色，立即生效</p>
        </div>
        <div className="wb-seg" role="group" aria-label="主题">
          <button
            type="button"
            className={theme === 'light' ? 'is-active' : ''}
            aria-pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          >
            浅色
          </button>
          <button
            type="button"
            className={theme === 'dark' ? 'is-active' : ''}
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          >
            深色
          </button>
        </div>
      </div>

      <div className="wb-prefs-row">
        <div className="wb-prefs-row-copy">
          <h4 className="wb-prefs-block-title">音效</h4>
          <p className="wb-prefs-row-desc">任务完成与失败时的提示音</p>
        </div>
        <div className="wb-seg" role="group" aria-label="音效">
          <button
            type="button"
            className={soundEnabled ? 'is-active' : ''}
            aria-pressed={soundEnabled}
            onClick={handleSoundOn}
          >
            开
          </button>
          <button
            type="button"
            className={!soundEnabled ? 'is-active' : ''}
            aria-pressed={!soundEnabled}
            onClick={() => setSoundEnabled(false)}
          >
            关
          </button>
        </div>
      </div>
    </div>
  );
}
