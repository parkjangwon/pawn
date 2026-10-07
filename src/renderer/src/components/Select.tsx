import type { SelectHTMLAttributes } from 'react'
import './Select.css'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'xs' | 'sm' | 'default' | 'lg'
}

export default function Select({
  size = 'default',
  className = '',
  children,
  ...rest
}: SelectProps): React.JSX.Element {
  return (
    <span className={`pawn-select pawn-select-${size}${className ? ` ${className}` : ''}`}>
      <select data-size={size} {...rest}>
        {children}
      </select>
      <svg
        className="pawn-select-chevron"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3.5 5.25L7 8.75L10.5 5.25"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
