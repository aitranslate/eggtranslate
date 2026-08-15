/**
 * React ErrorBoundary 组件
 * 捕获组件树中的错误，显示友好的降级 UI
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import { toAppError } from '@/utils/errors';
import { DefaultErrorFallback } from '@/components/DefaultErrorFallback';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 降级 UI */
  fallback?: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  /** 自定义错误记录器 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary 组件
 *
 * 捕获子组件树中的 JavaScript 错误，显示降级 UI 而不是崩溃整个应用
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 转换为标准错误
    const appError = toAppError(error);

    // 记录错误日志
    console.error('[ErrorBoundary] 捕获到错误:', {
      error: appError,
      componentStack: errorInfo.componentStack,
      errorBoundary: true
    });

    // 调用自定义错误处理器
    this.props.onError?.(appError, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      const { fallback } = this.props;

      // 使用自定义 fallback
      if (typeof fallback === 'function') {
        return fallback(error!, this.handleRetry);
      }

      if (fallback) {
        return fallback;
      }

      // 默认错误 UI
      return <DefaultErrorFallback error={error!} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}
