import type { HTMLAttributes } from 'react'
import './Badge.css'

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export default function Badge({
  variant = 'default',
  className = '',
  ...rest
}: BadgeProps): React.JSX.Element {
  return (
    <span
      data-variant={variant}
      className={`pawn-badge pawn-badge-${variant}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}
