/**
 * 列表空态：未配置 / 已配置共用一块面，不再叠 banner + hero + 「暂无项目」。
 */

import { Settings, Sparkles, Upload } from 'lucide-react';

interface MobileListEmptyProps {
  isConfigured: boolean;
  sampleLoading: boolean;
  onConfigure: () => void;
  onImport: () => void;
  onSample: () => void;
}

export function MobileListEmpty({
  isConfigured,
  sampleLoading,
  onConfigure,
  onImport,
  onSample,
}: MobileListEmptyProps) {
  return (
    <div className="m-empty">
      <h2 className="m-empty-title">
        {isConfigured ? '导入文件开始' : '先配置翻译 API'}
      </h2>
      <p className="m-empty-desc">
        {isConfigured
          ? '导入字幕或音视频，也可以先试用示例字幕'
          : '配好之后即可导入并翻译。也可以先试用示例看看界面'}
      </p>

      {isConfigured ? (
        <>
          <button type="button" className="m-hero-primary" onClick={onImport}>
            <Upload className="h-5 w-5" />
            导入文件
          </button>
          <button
            type="button"
            className="m-hero-secondary"
            onClick={onSample}
            disabled={sampleLoading}
          >
            <Sparkles className="h-4 w-4" />
            {sampleLoading ? '导入中…' : '试用示例字幕'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="m-hero-primary" onClick={onConfigure}>
            <Settings className="h-5 w-5" />
            配置 API
          </button>
          <button
            type="button"
            className="m-hero-secondary"
            onClick={onSample}
            disabled={sampleLoading}
          >
            <Sparkles className="h-4 w-4" />
            {sampleLoading ? '导入中…' : '试用示例字幕'}
          </button>
          <button type="button" className="m-hero-secondary" onClick={onImport}>
            <Upload className="h-4 w-4" />
            导入文件
          </button>
        </>
      )}
    </div>
  );
}
