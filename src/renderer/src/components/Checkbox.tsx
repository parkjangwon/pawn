import type { InputHTMLAttributes, ReactNode } from 'react'
import './Checkbox.css'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode
  indeterminate?: boolean
}

export default function Checkbox({
  label,
  indeterminate = false,
  className = '',
  ...rest
}: CheckboxProps): React.JSX.Element {
  return (
    <label className={`pawn-checkbox-label${className ? ` ${className}` : ''}`}>
      <input
        type="checkbox"
        className="pawn-checkbox-native"
        ref={(node) => {
          if (node) node.indeterminate = indeterminate
        }}
        {...rest}
      />
      <span className="pawn-checkbox-box" aria-hidden="true">
        <svg
          className="pawn-checkbox-check"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 6.25L5 8.75L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <svg
          className="pawn-checkbox-minus"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 6H9.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {label !== undefined ? <span className="pawn-checkbox-text">{label}</span> : null}
    </label>
  )
}
