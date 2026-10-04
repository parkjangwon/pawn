/**
 * Shared inline SVG icons (feather/lucide idiom): viewBox 0 0 24 24,
 * stroke currentColor, fill none. One source of truth for the path data that
 * was previously duplicated across 15+ components — same glyphs, same stroke
 * discipline (global.css forces stroke-width 2 on all [stroke] elements).
 *
 * Usage: <IconChevron size={12} /> — decorative by default (aria-hidden);
 * pass ariaLabel when the icon is the only content of a control.
 */
import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
  className?: string
  /** Accessible name — omit for decorative icons (the default). */
  ariaLabel?: string
}

function icon(path: ReactNode): (props: IconProps) => React.JSX.Element {
  return function Icon({ size = 14, className, ariaLabel }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={ariaLabel ? undefined : true}
        aria-label={ariaLabel}
      >
        {path}
      </svg>
    )
  }
}

export const IconChevronRight = icon(<polyline points="9 18 15 12 9 6" />)
export const IconChevronDown = icon(<polyline points="6 9 12 15 18 9" />)
export const IconCheck = icon(<polyline points="20 6 9 17 4 12" />)
export const IconX = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>
)
export const IconFolder = icon(
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
)
export const IconCopy = icon(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>
)
export const IconPlus = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>
)
export const IconSearch = icon(
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>
)
export const IconFile = icon(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </>
)
