import { Hono } from 'hono'

/**
 * A thin, authenticated proxy from the Reflect server to the headless GSD
 * (Kan) instance's REST API. Mounted under `/api/board` inside the server's
 * auth scope, so the native board UI reaches Kan using the caller's existing
 * Reflect session — the Kan API key lives only here, injected server-side and
 * never sent to the browser.
 *
 * Whatever path the client hits under `/api/board/*` is forwarded verbatim to
 * `${gsdUrl}/api/v1/*`; the board UI therefore has Kan's whole v1 surface
 * (boards, lists, cards, labels, checklists, comments) without the server
 * needing a typed binding per endpoint.
 */
export function createBoardProxy(gsdUrl: string, gsdApiKey: string): Hono {
  const app = new Hono()

  app.all('/*', async (c) => {
    // Strip the mount prefix; keep the remainder + query string intact.
    const rest = c.req.path.replace(/^\/api\/board/, '')
    const target = `${gsdUrl}/api/v1${rest}${new URL(c.req.url).search}`

    const headers: Record<string, string> = {
      authorization: `Bearer ${gsdApiKey}`,
    }
    const contentType = c.req.header('content-type')
    if (contentType !== undefined) {
      headers['content-type'] = contentType
    }

    const method = c.req.method
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const upstream = await fetch(target, {
      method,
      headers,
      ...(hasBody ? { body: await c.req.arrayBuffer() } : {}),
    })

    // Pass the body and content-type straight back; the status carries Kan's
    // own validation/permission errors through unchanged. `no-store` keeps the
    // browser from caching board reads — the board must always reflect the
    // live data, and a card just moved must not read stale on the next mount.
    const body = await upstream.arrayBuffer()
    const responseType = upstream.headers.get('content-type') ?? 'application/json'
    return c.body(body, upstream.status as never, {
      'content-type': responseType,
      'cache-control': 'no-store',
    })
  })

  return app
}
