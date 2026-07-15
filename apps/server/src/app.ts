import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { toAppError, type AppError } from '@reflect/core'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { renderLoginPage } from './login-page'
import type { SessionAuth } from './auth'
import type { BridgeRouter } from './bridge-router'
import type { ServerConfig } from './config'

const SESSION_COOKIE = 'reflect_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000

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

/** Assemble the HTTP app: login, the bridge RPC, and (when built) the web UI. */
export function createApp(
  config: ServerConfig,
  auth: SessionAuth,
  router: BridgeRouter,
  webDistDir: string | null,
): Hono {
  const app = new Hono()

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
    if (!auth.checkPassword(password)) {
      return wantsJson
        ? c.json({ error: { kind: 'auth', message: 'wrong password' } }, 401)
        : c.redirect(`/login?failed=1&next=${encodeURIComponent(next)}`, 302)
    }
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
      if (!auth.checkPassword(c.req.query('password') ?? '')) {
        return c.json({ error: { kind: 'auth', message: 'wrong password' } }, 401)
      }
      setSessionCookie(c)
      const next = c.req.query('next') ?? '/'
      return c.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/', 302)
    })
  }

  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // Bearer token (agents) or session cookie (the browser app) — everything
  // under /api except login/health requires one of the two.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/login' || c.req.path === '/api/health') {
      return next()
    }
    const bearer = c.req.header('authorization')?.replace(/^Bearer /, '') ?? ''
    if (auth.checkAgentToken(bearer)) {
      return next()
    }
    const session = getCookie(c, SESSION_COOKIE)
    if (session !== undefined && auth.verifySession(session)) {
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
