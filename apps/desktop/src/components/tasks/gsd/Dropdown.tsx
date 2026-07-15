import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Ported from Kan apps/web/src/components/Dropdown.tsx — Kan's exact menu
 * styling, but self-contained (no @headlessui version coupling): a trigger
 * button and an absolute menu with click-outside dismissal.
 */
export default function Dropdown({
  items,
  children,
  disabled,
}: {
  items: { label: string; action?: () => void; icon?: ReactNode; disabled?: boolean }[]
  children: ReactNode
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 w-7 items-center justify-center rounded-[5px] hover:bg-light-200 focus:outline-none dark:hover:bg-dark-200"
      >
        {children}
      </button>
      {open ? (
        <div className="absolute right-0 z-[100] isolate mt-2 w-56 origin-top-right rounded-md border border-light-200 bg-white p-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-dark-400 dark:bg-dark-300">
          <div className="flex flex-col">
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  item.action?.()
                  setOpen(false)
                }}
                disabled={item.disabled ?? !item.action}
                className="flex w-auto items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left text-sm text-neutral-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-60 dark:text-dark-950 dark:hover:bg-dark-400"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
