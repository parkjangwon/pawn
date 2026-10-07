import type { ButtonHTMLAttributes } from 'react'
import './Button.css'

export type ButtonVariant =
  | 'default'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'warning'
  | 'link'
export type ButtonSize =
  | 'xs'
  | 'sm'
  | 'default'
  | 'lg'
  | 'icon'
  | 'icon-xs'
  | 'icon-sm'
  | 'icon-md'
  | 'icon-lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export default function Button({
  variant = 'default',
  size = 'default',
  type = 'button',
  className = '',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={`pawn-btn pawn-btn-${variant} pawn-btn-${size}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}
