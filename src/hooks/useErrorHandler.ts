/**
 * 统一错误处理 Hook
 * 提供标准的错误处理能力，包括 toast 通知、日志记录和错误上报
 */

import { useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  isAbortError,
  toAppError,
  getUserMessage,
  ErrorContext,
  LogLevel
} from '@/utils/errors';
import { logger } from '@/utils/logger';

/**
 * 错误处理选项
 */
export interface ErrorHandlerOptions {
  /** 是否显示 toast 通知（默认 true） */
  showToast?: boolean;
  /** 是否记录日志（默认 true） */
  log?: boolean;
  /** 自定义成功消息 */
  successMessage?: string;
  /** 自定义错误消息前缀 */
  errorPrefix?: string;
  /** 日志级别（默认 ERROR） */
  logLevel?: LogLevel;
  /** 错误上下文 */
  context?: ErrorContext;
}

/**
 * 错误处理结果
 */
export interface ErrorHandlerResult {
  /** 是否成功 */
  success: boolean;
  /** 错误对象（如果失败） */
  error?: Error;
}

/**
 * 统一错误处理 Hook
 *
 * @example
 * const { handleError, handleAsync } = useErrorHandler();
 *
 * // 同步错误处理
 * try {
 *   riskyOperation();
 * } catch (error) {
 *   handleError(error, { operation: '翻译文件' });
 * }
 *
 * // 异步错误处理
 * const result = await handleAsync(
 *   async () => await translateFile(file),
 *   { operation: '翻译文件' }
 * );
 */
export function useErrorHandler() {
  /**
   * 记录错误日志
   */
  const logError = useCallback((
    error: Error,
    level: LogLevel = LogLevel.ERROR,
    context?: ErrorContext
  ) => {
    const prefix = context?.operation ? `[${context.operation}]` : '';
    const message = `${prefix} ${error.message}`;

    switch (level) {
      case LogLevel.DEBUG:
        logger.debug('[DEBUG]', message, error);
        break;
      case LogLevel.INFO:
        logger.info('[INFO]', message, error);
        break;
      case LogLevel.WARN:
        logger.warn('[WARN]', message, error);
        break;
      case LogLevel.ERROR:
        logger.error('[ERROR]', message, error);
        break;
    }

    // 记录额外上下文
    if (context?.details) {
      logger.error('[ERROR Details]', context.details);
    }
  }, []);

  /**
   * 显示错误 toast
   */
  const showErrorToast = useCallback((
    error: Error,
    prefix?: string
  ) => {
    const message = getUserMessage(error);
    const fullMessage = prefix ? `${prefix}: ${message}` : message;
    toast.error(fullMessage);
  }, []);

  /**
   * 核心错误处理函数
   *
   * @param error - 捕获的错误
   * @param options - 处理选项
   * @returns 处理结果
   */
  const handleError = useCallback((
    error: unknown,
    options: ErrorHandlerOptions = {}
  ): ErrorHandlerResult => {
    const {
      showToast = true,
      log = true,
      errorPrefix,
      logLevel = LogLevel.ERROR,
      context
    } = options;

    // 转换为标准错误
    const appError = toAppError(error);

    // 记录日志
    if (log) {
      logError(appError, logLevel, context);
    }

    // 处理取消操作（特殊处理）
    if (isAbortError(appError)) {
      if (showToast) {
        toast.success(context?.operation ? `${context.operation}已取消` : '操作已取消');
      }
      return { success: false, error: appError };
    }

    // 显示错误 toast
    if (showToast) {
      const prefix = errorPrefix || context?.operation || '操作';
      showErrorToast(appError, `${prefix}失败`);
    }

    return { success: false, error: appError };
  }, [logError, showErrorToast]);

  /**
   * 包装异步操作，自动处理错误
   *
   * @param asyncFn - 异步函数
   * @param options - 处理选项
   * @returns 操作结果
   *
   * @example
   * const result = await handleAsync(
   *   () => fetch('/api/data'),
   *   { operation: '加载数据', successMessage: '加载成功' }
   * );
   * if (result.success) {
   *   // 处理成功
   * }
   */
  const handleAsync = useCallback(async <T>(
    asyncFn: () => Promise<T>,
    options: ErrorHandlerOptions = {}
  ): Promise<ErrorHandlerResult & { data?: T }> => {
    const { successMessage } = options;

    try {
      const data = await asyncFn();

      // 显示成功消息
      if (successMessage) {
        toast.success(successMessage);
      }

      return { success: true, data };
    } catch (error) {
      return handleError(error, options);
    }
  }, [handleError]);

  return {
    handleError,
    handleAsync,
    isAbortError,
    toAppError,
    getUserMessage
  };
}
