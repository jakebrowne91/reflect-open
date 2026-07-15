import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { HttpBindings } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { toAppError, type AppError } from '@reflect/core'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { createAgentRoutes } from './agent-routes'
import { createBoardProxy } from './board-proxy'
import { buildMcpServer } from './mcp'
import { renderLoginPage } from './login-page'
import type { SessionAuth } from './auth'
import type { BridgeRouter } from './bridge-router'
import type { ServerConfig } from './config'
import type { GraphService } from './graph-service'

const SESSION_COOKIE = 'reflect_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000

// Login throttle: short passwords on a public host live or die by this.
// Sliding per-IP window, in memory — a restart forgiving the counters is an
// acceptable trade for zero infrastructure.
const LOGIN_WINDOW_MS = 15 * 60_000
const LOGIN_MAX_FAILURES = 5
const failedLogins = new Map<string, number[]>()

function clientIp(c: Context): string {
  return (
    c.req.header('fly-client-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  )
}

function loginBlocked(ip: string): boolean {
  const cutoff = Date.now() - LOGIN_WINDOW_MS
  const recent = (failedLogins.get(ip) ?? []).filter((at) => at >= cutoff)
  if (recent.length === 0) {
    failedLogins.delete(ip)
    return false
  }
  failedLogins.set(ip, recent)
  return recent.length >= LOGIN_MAX_FAILURES
}

function recordLoginFailure(ip: string): void {
  failedLogins.set(ip, [...(failedLogins.get(ip) ?? []), Date.now()])
}

const invokeBodySchema = z.object({
  command: z.string(),
  args: z.record(z.string(), z.unknown()),
})

function errorStatus(error: AppError): ContentfulStatusCode {
  switch (error.kind) {
    case 'auth':
      return 401
    case 'notFound':
      return 404
    case 'unknown':
      return 500
    default:
      return 400
  }
}

/** Assemble the HTTP app: login, the bridge RPC, agent surfaces, the web UI. */
export function createApp(
  config: ServerConfig,
  auth: SessionAuth,
  router: BridgeRouter,
  graph: GraphService,
  webDistDir: string | null,
): Hono<{ Bindings: HttpBindings }> {
  const app = new Hono<{ Bindings: HttpBindings }>()

  /** Bearer token (agents) or session cookie (the browser) — one gate. */
  const isAuthenticated = (c: Context): boolean => {
    const bearer = c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''
    if (auth.checkAgentToken(bearer)) {
      return true
    }
    const session = getCookie(c, SESSION_COOKIE)
    return session !== undefined && auth.verifySession(session)
  }

  const setSessionCookie = (c: Context): void => {
    setCookie(c, SESSION_COOKIE, auth.issueSession(SESSION_TTL_MS), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.secureCookies,
      path: '/',
      maxAge: SESSION_TTL_MS / 1_000,
    })
  }

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/login', (c) =>
    c.html(renderLoginPage(c.req.query('next') ?? '/', c.req.query('failed') === '1')),
  )

  app.post('/api/login', async (c) => {
    const contentType = c.req.header('content-type') ?? ''
    let password = ''
    let next = '/'
    let wantsJson = false
    if (contentType.includes('application/json')) {
      wantsJson = true
      const body = z.object({ password: z.string() }).safeParse(await c.req.json())
      password = body.success ? body.data.password : ''
    } else {
      const form = await c.req.parseBody()
      password = typeof form['password'] === 'string' ? form['password'] : ''
      next = typeof form['next'] === 'string' ? form['next'] : '/'
    }
    const ip = clientIp(c)
    if (loginBlocked(ip)) {
      return c.json(
        { error: { kind: 'auth', message: 'too many attempts — try again in 15 minutes' } },
        429,
      )
    }
    if (!auth.checkPassword(password)) {
      recordLoginFailure(ip)
      return wantsJson
        ? c.json({ error: { kind: 'auth', message: 'wrong password' } }, 401)
        : c.redirect(`/login?failed=1&next=${encodeURIComponent(next)}`, 302)
    }
    failedLogins.delete(ip)
    setSessionCookie(c)
    if (wantsJson) {
      return c.json({ ok: true })
    }
    return c.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/', 302)
  })

  // Opt-in magic-link login (REFLECT_ALLOW_URL_LOGIN=1): lets scripts and
  // headless browsers establish a session from a URL. Off by default — a
  // password in a URL lands in histories and access logs.
  if (process.env['REFLECT_ALLOW_URL_LOGIN'] === '1') {
    app.get('/api/login', (c) => {
      const ip = clientIp(c)
      if (loginBlocked(ip)) {
        return c.json(
          { error: { kind: 'auth', message: 'too many attempts — try again in 15 minutes' } },
          429,
        )
      }
      if (!auth.checkPassword(c.req.query('password') ?? '')) {
        recordLoginFailure(ip)
        return c.json({ error: { kind: 'auth', message: 'wrong password' } }, 401)
      }
      failedLogins.delete(ip)
      setSessionCookie(c)
      const next = c.req.query('next') ?? '/'
      return c.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/', 302)
    })
  }

  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // Everything under /api except login/health requires auth.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/login' || c.req.path === '/api/health') {
      return next()
    }
    if (isAuthenticated(c)) {
      return next()
    }
    return c.json({ error: { kind: 'auth', message: 'login required' } }, 401)
  })

  app.post('/api/invoke', async (c) => {
    const parsed = invokeBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { error: { kind: 'parse', message: `bad invoke body: ${parsed.error.message}` } },
        400,
      )
    }
    try {
      const result = await router.invoke(parsed.data.command, parsed.data.args)
      // `undefined` is not valid JSON; the bridge contract's "no result" is null.
      return c.json({ result: result ?? null })
    } catch (cause) {
      const error = toAppError(cause)
      return c.json({ error }, errorStatus(error))
    }
  })

  // Agent surfaces: boring JSON under /api/agent (inside the auth scope
  // above), and MCP Streamable HTTP at /mcp with the same credentials.
  app.route('/api/agent', createAgentRoutes(graph))

  // The native board's data path: /api/board/* → the headless GSD instance,
  // authenticated by the Reflect session, key injected server-side.
  if (config.gsdUrl !== null && config.gsdApiKey !== null) {
    app.route('/api/board', createBoardProxy(config.gsdUrl, config.gsdApiKey))
  }

  app.all('/mcp', async (c) => {
    if (!isAuthenticated(c)) {
      return c.json({ error: { kind: 'auth', message: 'login required' } }, 401)
    }
    // Stateless per-request transport: no session ids, no SSE resumption —
    // every POST is a complete JSON-RPC exchange against the shared graph.
    const server = buildMcpServer(graph)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    const body = c.req.method === 'POST' ? await c.req.json() : undefined
    await transport.handleRequest(c.env.incoming, c.env.outgoing, body)
    // The transport wrote to the raw Node response already.
    return RESPONSE_ALREADY_SENT
  })

  // The built web app, when present (production images bundle it). Vite dev
  // serves the UI itself and proxies /api here instead.
  if (webDistDir !== null && existsSync(path.join(webDistDir, 'index.html'))) {
    const indexHtml = readFileSync(path.join(webDistDir, 'index.html'), 'utf8')
    app.use(
      '/*',
      serveStatic({ root: path.relative(process.cwd(), webDistDir) }),
    )
    // SPA fallback: any non-file route boots the app shell.
    app.get('*', (c) => c.html(indexHtml))
  }

  return app
}
