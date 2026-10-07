import type { ButtonHTMLAttributes } from 'react'
import './Switch.css'

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'value'
> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  size?: 'sm' | 'default'
}

export default function Switch({
  checked,
  onCheckedChange,
  size = 'default',
  className = '',
  disabled,
  ...rest
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      data-size={size}
      disabled={disabled}
      className={`pawn-switch pawn-switch-${size}${className ? ` ${className}` : ''}`}
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    >
      <span className="pawn-switch-thumb" aria-hidden="true" />
    </button>
  )
}
