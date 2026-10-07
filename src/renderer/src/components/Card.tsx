import type { HTMLAttributes } from 'react'
import './Card.css'

type DivProps = HTMLAttributes<HTMLDivElement>

export interface CardProps extends DivProps {
  size?: 'default' | 'sm'
}

export default function Card({
  size = 'default',
  className = '',
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <div
      data-size={size}
      className={`pawn-card pawn-card-${size}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  )
}

export function CardHeader({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-card-header${className ? ` ${className}` : ''}`} {...rest} />
}

export function CardTitle({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-card-title${className ? ` ${className}` : ''}`} {...rest} />
}

export function CardDescription({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-card-desc${className ? ` ${className}` : ''}`} {...rest} />
}

export function CardAction({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-card-action${className ? ` ${className}` : ''}`} {...rest} />
}

export function CardContent({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-card-content${className ? ` ${className}` : ''}`} {...rest} />
}

export function CardFooter({ className = '', ...rest }: DivProps): React.JSX.Element {
  return <div className={`pawn-card-footer${className ? ` ${className}` : ''}`} {...rest} />
}
