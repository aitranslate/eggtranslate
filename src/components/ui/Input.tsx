import React from 'react';

export type InputSize = 'sm' | 'md';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/**
 * 全站输入框 primitive — 与 Button 同高节奏
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ inputSize = 'md', className, type = 'text', ...rest }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cx(
          'apple-input',
          inputSize === 'sm' && 'apple-input-sm',
          className
        )}
        {...rest}
      />
    );
  }
);

Input.displayName = 'Input';
