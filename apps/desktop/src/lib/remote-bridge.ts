import { hasBridge, setBridge, type AppPlatform, type IpcBridge } from '@reflect/core'
import { z } from 'zod'

const errorEnvelopeSchema = z.object({
  error: z.object({ kind: z.string(), message: z.string() }),
})
const resultEnvelopeSchema = z.object({ result: z.unknown() })

/**
 * The server-backed bridge: every command crosses HTTP to a Reflect server
 * (`apps/server`) that owns the real graph folder and index — the remote
 * sibling of the Tauri bridge. Same-origin only: in dev, Vite proxies `/api`
 * to the server; in production the server serves the app itself.
 *
 * A 401 means the session expired (or never existed) — the only recovery is
 * the login page, so the bridge navigates there and never resolves; the app
 * is torn down by the navigation, not by an error cascade.
 */
export function createRemoteBridge(platform: AppPlatform): IpcBridge {
  async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
    // The platform is a client fact (which surface tree booted), not a
    // server fact — answer it locally.
    if (command === 'app_platform') {
      return platform
    }
    const response = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, args }),
      credentials: 'same-origin',
    })
    if (response.status === 401) {
      const next = `${window.location.pathname}${window.location.search}`
      window.location.assign(`/login?next=${encodeURIComponent(next)}`)
      return new Promise(() => {})
    }
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = errorEnvelopeSchema.safeParse(body)
      // The thrown shape satisfies `isAppError`, so core's `toAppError`
      // passes it through and callers branch on `kind` as usual.
      throw parsed.success
        ? parsed.data.error
        : { kind: 'network', message: `invoke "${command}" failed with ${response.status}` }
    }
    return resultEnvelopeSchema.parse(body).result
  }

  return {
    invoke,
    // Server push (file watcher, sync events) is a later phase: an SSE
    // channel slots in here. Local writes still refresh the UI through
    // core's in-process local-write echo, exactly like the dev bridge.
    listen: async () => () => {},
  }
}

/** True when this page should boot against a Reflect server. */
function remoteBridgeRequested(): boolean {
  return (
    import.meta.env['VITE_REFLECT_REMOTE'] === '1' ||
    (import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get('bridge') === 'remote')
  )
}

/** The surface tree to boot (`?platform=`), defaulting to desktop. */
function requestedPlatform(): AppPlatform {
  const requested = new URLSearchParams(window.location.search).get('platform')
  return requested === 'ios' || requested === 'android' ? requested : 'desktop'
}

/**
 * Install the remote bridge when this session asked for one
 * (`VITE_REFLECT_REMOTE=1` builds, or `?bridge=remote` in dev). Called from
 * `main.tsx` BEFORE React renders, exactly like `installTauriBridge`: the
 * providers capture `hasBridge()` at their first render (e.g. the settings
 * query's `enabled`), so a bridge installed any later leaves the app running
 * on session-only defaults instead of server state. The Tauri bridge wins
 * when both are present — a native shell always outranks a network stand-in.
 */
export function installRemoteBridgeIfRequested(): void {
  if (!remoteBridgeRequested() || hasBridge()) {
    return
  }
  const platform = requestedPlatform()
  setBridge(createRemoteBridge(platform))
  console.info(`[remote-bridge] installed: platform=${platform}, graph served over /api`)
}
