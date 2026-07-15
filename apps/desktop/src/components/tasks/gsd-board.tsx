import { useState, type ReactElement } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The real GSD (Kan) board, embedded in the Tasks screen. The Reflect server
 * keeps this board in step with the markdown task lines (open tasks → Inbox
 * cards, cards dragged to Done → ticked checkboxes) — this pane is the full
 * board UI for the workflow half of that loop.
 *
 * Configured at build time with `VITE_REFLECT_GSD_URL`; absent in local dev,
 * where the native board (`TaskBoard`) stands in.
 *
 * Cross-origin caveat: the board is its own origin, so its login cookie is
 * third-party inside this frame and some browsers block it. The header always
 * offers "Open in GSD", which works regardless; a shared parent domain (a
 * custom domain for both apps) would make the in-frame session first-party.
 */
export function GsdBoard({ url }: { url: string }): ReactElement {
  const [nonce, setNonce] = useState(0)
  const [failed, setFailed] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-1.5 lg:px-10">
        <span className="text-xs text-text-muted">Live board — synced with your notes</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFailed(false)
              setNonce((value) => value + 1)
            }}
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
      {failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-text-secondary">
            The board couldn’t load in-frame — your browser may be blocking its
            session cookie here.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-[color:var(--text-on-brand)]"
          >
            <ExternalLink aria-hidden className="size-4" />
            Open the board in a new tab
          </a>
        </div>
      ) : (
        <iframe
          key={nonce}
          src={url}
          title="GSD board"
          className="min-h-0 flex-1 border-0"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

/** The configured GSD board URL, or null when this build has no board. */
export function gsdBoardUrl(): string | null {
  const url = import.meta.env['VITE_REFLECT_GSD_URL']
  return typeof url === 'string' && url !== '' ? url : null
}
