import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import './Input.css'

export type InputSize = 'xs' | 'sm' | 'default' | 'lg'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize
}

export default function Input({
  size = 'default',
  className = '',
  ...rest
}: InputProps): React.JSX.Element {
  return (
    <input
      data-size={size}
      className={`pawn-input pawn-input-${size}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={`pawn-textarea${className ? ` ${className}` : ''}`} {...rest} />
}
