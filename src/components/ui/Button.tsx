import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: '',
  secondary: 'apple-button-secondary',
  ghost: 'apple-button-ghost',
  danger: 'apple-button-danger',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'apple-button-sm',
  md: '',
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/**
 * 全站按钮 primitive — 软方圆工具风
 * 主色仅蓝；success 绿不作 CTA
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, type = 'button', children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cx('apple-button', sizeClass[size], variantClass[variant], className)}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
