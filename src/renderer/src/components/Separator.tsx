import type { HTMLAttributes } from 'react'
import './Separator.css'

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
}

export default function Separator({
  orientation = 'horizontal',
  className = '',
  ...rest
}: SeparatorProps): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={`pawn-separator pawn-separator-${orientation}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}
