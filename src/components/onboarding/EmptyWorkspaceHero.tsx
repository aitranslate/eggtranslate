/**
 * 空工作区 Hero：按配置/文件状态切换主 CTA
 */

import React from 'react';
import { FileText, Upload, Sparkles } from 'lucide-react';
import { resolveEmptyWorkspaceCopy } from '@/utils/onboarding';

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
  const copy = resolveEmptyWorkspaceCopy({ isDragging, fileCount, isConfigured });
  const samplePrimary = copy.primary === 'sample';
  const importPrimary = copy.primary === 'import';

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
      <h3>{copy.title}</h3>
      <p>{copy.description}</p>
      <div className="wb-stage-empty-actions">
        {/* 主 CTA 优先：未配置时示例在前，已配置时导入在前 */}
        {samplePrimary && copy.showSample && (
          <button
            type="button"
            className="wb-stage-cta"
            onClick={onSample}
            disabled={sampleLoading}
            data-testid="desktop-sample-import"
            title="导入内置示例字幕"
          >
            <Sparkles className="h-3.5 w-3.5 inline-block mr-1 align-[-2px]" />
            {sampleLoading ? '导入中…' : '试用示例字幕'}
          </button>
        )}
        {copy.showImport && (
          <button
            type="button"
            className={`wb-stage-cta${importPrimary ? '' : ' secondary'}`}
            onClick={onImport}
            title={importShortcut ? `${importShortcut} 导入` : '导入文件'}
            data-testid="desktop-import-cta"
          >
            导入文件
            {importShortcut ? (
              <span className="wb-stage-cta-keys" aria-hidden>
                {importShortcut}
              </span>
            ) : null}
          </button>
        )}
        {!samplePrimary && copy.showSample && (
          <button
            type="button"
            className="wb-stage-cta secondary"
            onClick={onSample}
            disabled={sampleLoading}
            data-testid="desktop-sample-import"
            title="导入内置示例字幕"
          >
            <Sparkles className="h-3.5 w-3.5 inline-block mr-1 align-[-2px]" />
            {sampleLoading ? '导入中…' : '试用示例字幕'}
          </button>
        )}
        {copy.showConfigure && (
          <button type="button" className="wb-stage-cta secondary" onClick={onConfigure}>
            配置 API
          </button>
        )}
      </div>
    </div>
  );
};
