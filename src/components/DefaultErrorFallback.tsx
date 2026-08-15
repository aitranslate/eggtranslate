/**
 * ErrorBoundary 默认降级 UI（独立文件，保证 ErrorBoundary.tsx 只导出组件）
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getUserMessage } from '@/utils/errors';

export function DefaultErrorFallback({
  error,
  onRetry
}: {
  error: Error;
  onRetry: () => void;
}) {
  const userMessage = getUserMessage(error);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900/20 to-blue-900/20 p-4">
      <div className="max-w-md w-full bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 p-8 shadow-2xl">
        {/* 错误图标 */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
        </div>

        {/* 标题 */}
        <h1 className="text-2xl font-bold text-white text-center mb-2">
          出错了
        </h1>

        {/* 错误消息 */}
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
          <p className="text-white/90 text-center">
            {userMessage}
          </p>
        </div>

        {/* 技术详情（开发环境） */}
        {import.meta.env.DEV && (
          <details className="mb-6">
            <summary className="text-white/60 text-sm cursor-pointer hover:text-white/80 transition-colors">
              技术详情
            </summary>
            <pre className="mt-2 text-xs text-white/40 bg-black/20 rounded p-3 overflow-auto max-h-40">
              {error.name}: {error.message}
              {'\n'}
              {error.stack}
            </pre>
          </details>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onRetry}
            className="flex-1 flex items-center justify-center space-x-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/30 rounded-lg py-3 px-4 transition-all duration-200 hover:scale-105"
          >
            <RefreshCw className="w-4 h-4" />
            <span>重试</span>
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="flex-1 flex items-center justify-center space-x-2 bg-white/10 hover:bg-white/20 text-white/80 border border-white/20 rounded-lg py-3 px-4 transition-all duration-200 hover:scale-105"
          >
            <span>返回首页</span>
          </button>
        </div>

        {/* 提示信息 */}
        <p className="text-center text-white/40 text-sm mt-6">
          如果问题持续存在，请刷新页面或联系技术支持
        </p>
      </div>
    </div>
  );
}
