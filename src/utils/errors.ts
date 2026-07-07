/**
 * 统一错误类型定义
 * 提供标准化的错误类，便于错误处理和用户友好的错误消息
 */

/**
 * 应用基础错误类
 * 所有自定义错误都应该继承这个类
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userMessage?: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * 检查是否为特定类型的错误
   */
  isType(error: Error): error is this {
    return error instanceof this.constructor;
  }
}

/**
 * 操作取消错误
 * 用于标识用户主动取消的操作（如翻译被取消）
 */
export class AbortOperationError extends AppError {
  constructor(message: string = '操作已被取消', userMessage: string = '操作已取消') {
    super(message, 'ABORT_OPERATION', userMessage, 499);
  }
}

/**
 * 工具函数：检查是否为操作取消错误
 */
export function isAbortError(error: unknown): error is AbortOperationError {
  return (
    error instanceof AbortOperationError ||
    error instanceof Error && (
      error.name === 'AbortError' ||
      error.message?.includes('翻译被取消') ||
      error.message?.includes('操作被取消')
    )
  );
}

/**
 * 工具函数：获取用户友好的错误消息
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.userMessage || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '发生未知错误';
}

/**
 * 工具函数：从未知错误创建 AppError
 */
export function toAppError(error: unknown, defaultMessage: string = '操作失败'): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    if (isAbortError(error)) {
      return new AbortOperationError(error.message);
    }
    return new AppError(error.message, 'UNKNOWN_ERROR', defaultMessage);
  }

  return new AppError(defaultMessage, 'UNKNOWN_ERROR', defaultMessage);
}

/**
 * 错误日志级别
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * 错误上下文信息
 */
export interface ErrorContext {
  operation?: string;      // 操作名称（如"翻译文件"、"加载配置"）
  fileName?: string;       // 相关文件名
  endpoint?: string;       // API 端点
  details?: Record<string, unknown>; // 额外详情
}
