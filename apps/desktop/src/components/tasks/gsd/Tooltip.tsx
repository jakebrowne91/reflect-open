import type { ReactNode } from 'react'

/**
 * Lightweight stand-in for Kan's tippy.js Tooltip. In the board port its
 * `content` only ever carries a permission-denied hint, which never fires for
 * the single owner — so this renders the trigger and exposes any content as a
 * native title. Keeps the JSX shape identical without pulling tippy.js in.
 */
export function Tooltip({
  children,
  content,
}: {
  children: ReactNode
  content?: ReactNode
  placement?: string
  delay?: number | [number, number]
}) {
  return (
    <div className="inline-flex" title={typeof content === 'string' ? content : undefined}>
      {children}
    </div>
  )
}
