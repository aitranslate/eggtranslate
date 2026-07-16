/**
 * 空工作区：导入 / 示例 / 配置 API（无新手引导状态机）
 */

import React from 'react';
import { FileText, Upload, Sparkles } from 'lucide-react';

export interface EmptyWorkspaceHeroProps {
  isDragging: boolean;
  fileCount: number;
  isConfigured: boolean;
  sampleLoading: boolean;
  importShortcut?: string;
  onImport: () => void;
  onSample: () => void;
  onConfigure: () => void;
  onDragOver?: React.DragEventHandler;
  onDragLeave?: React.DragEventHandler;
  onDrop?: React.DragEventHandler;
}

export const EmptyWorkspaceHero: React.FC<EmptyWorkspaceHeroProps> = ({
  isDragging,
  fileCount,
  isConfigured,
  sampleLoading,
  importShortcut,
  onImport,
  onSample,
  onConfigure,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const title = isDragging
    ? '松开以导入'
    : fileCount > 0
      ? '选择左侧任务'
      : isConfigured
        ? '导入文件开始'
        : '字幕翻译 · 音视频转录';

  const description = isDragging
    ? '支持 SRT 字幕，或 MP4 / MP3 等音视频'
    : fileCount > 0
      ? '在侧栏点选文件以编辑字幕'
      : isConfigured
        ? 'SRT 直接翻译；音视频可转录后翻译'
        : '导入 SRT / 音视频，或试用示例字幕';

  return (
    <div
      className={`wb-stage-empty wb-stage-drop ${isDragging ? 'is-drag' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="wb-stage-empty-icon">
        {isDragging ? <Upload className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {!isDragging && fileCount === 0 && (
        <div className="wb-stage-empty-actions">
          {!isConfigured ? (
            <>
              <button
                type="button"
                className="wb-stage-cta"
                onClick={onSample}
                disabled={sampleLoading}
                data-testid="desktop-sample-import"
              >
                <Sparkles className="h-3.5 w-3.5 inline-block mr-1 align-[-2px]" />
                {sampleLoading ? '导入中…' : '试用示例字幕'}
              </button>
              <button
                type="button"
                className="wb-stage-cta secondary"
                onClick={onImport}
                data-testid="desktop-import-cta"
                title={importShortcut ? `${importShortcut} 导入` : '导入文件'}
              >
                导入文件
                {importShortcut ? (
                  <span className="wb-stage-cta-keys" aria-hidden>
                    {importShortcut}
                  </span>
                ) : null}
              </button>
              <button type="button" className="wb-stage-cta secondary" onClick={onConfigure}>
                配置 API
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="wb-stage-cta"
                onClick={onImport}
                data-testid="desktop-import-cta"
                title={importShortcut ? `${importShortcut} 导入` : '导入文件'}
              >
                导入文件
                {importShortcut ? (
                  <span className="wb-stage-cta-keys" aria-hidden>
                    {importShortcut}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className="wb-stage-cta secondary"
                onClick={onSample}
                disabled={sampleLoading}
                data-testid="desktop-sample-import"
              >
                <Sparkles className="h-3.5 w-3.5 inline-block mr-1 align-[-2px]" />
                {sampleLoading ? '导入中…' : '试用示例字幕'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
