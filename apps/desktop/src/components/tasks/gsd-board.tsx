import { useState, type ReactElement } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The board view: your actual GSD (the Kan app vendored at `apps/gsd`),
 * embedded in the Tasks screen — every feature, shortcut, filter, and custom
 * card field it has, because it is the real app, not a reimplementation.
 *
 * Configured at build time with `VITE_REFLECT_GSD_URL`; absent in local dev,
 * where the markdown-only fallback board stands in.
 *
 * Cross-origin note: while GSD is on a different origin from Reflect, its
 * session cookie is third-party inside this frame and some browsers block it —
 * the header always offers "Open in GSD", which works regardless. Serving both
 * apps under one domain makes the in-frame session first-party (the seamless
 * end state).
 */
export function GsdBoard({ url }: { url: string }): ReactElement {
  const [nonce, setNonce] = useState(0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-1.5 lg:px-10">
        <span className="text-xs text-text-muted">GSD — your board</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNonce((value) => value + 1)}
            className="text-xs text-text-muted"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Reload
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[color:var(--accent-soft-text)] hover:bg-[color:var(--accent-soft)]"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Open in GSD
          </a>
        </div>
      </div>
      <iframe
        key={nonce}
        src={url}
        title="GSD board"
        className="min-h-0 flex-1 border-0"
      />
    </div>
  )
}

/** The configured GSD URL, or null when this build has no board. */
export function gsdBoardUrl(): string | null {
  const url = import.meta.env['VITE_REFLECT_GSD_URL']
  return typeof url === 'string' && url !== '' ? url : null
}
