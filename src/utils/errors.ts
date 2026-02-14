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
 * 网络请求错误
 */
export class NetworkError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(
      message,
      'NETWORK_ERROR',
      userMessage || '网络连接失败，请检查网络设置',
      0
    );
  }
}

/**
 * 验证错误
 */
export class ValidationError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(
      message,
      'VALIDATION_ERROR',
      userMessage || '输入数据验证失败',
      400
    );
  }
}

/**
 * API 调用错误
 */
export class ApiError extends AppError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    userMessage?: string
  ) {
    super(
      message,
      'API_ERROR',
      userMessage || 'API 请求失败，请稍后重试',
      500
    );
  }
}

/**
 * 文件处理错误
 */
export class FileProcessingError extends AppError {
  constructor(message: string, public readonly fileName?: string, userMessage?: string) {
    super(
      message,
      'FILE_PROCESSING_ERROR',
      userMessage || '文件处理失败',
      422
    );
  }
}

/**
 * 翻译错误
 */
export class TranslationError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(
      message,
      'TRANSLATION_ERROR',
      userMessage || '翻译过程中发生错误',
      500
    );
  }
}

/**
 * 转录错误
 */
export class TranscriptionError extends AppError {
  constructor(message: string, userMessage?: string) {
    super(
      message,
      'TRANSCRIPTION_ERROR',
      userMessage || '转录过程中发生错误',
      500
    );
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
  details?: Record<string, any>; // 额外详情
}
