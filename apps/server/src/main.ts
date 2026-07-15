import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createSessionAuth } from './auth'
import { createBridgeRouter } from './bridge-router'
import { loadConfig } from './config'
import { createFsFileStore } from './fs-file-store'
import { createServerIndexDb } from './index-db'

const config = loadConfig(process.env)

// The real index migrations, straight from the monorepo checkout; deploys
// that relocate the server must point this at their bundled copy.
const migrationsDir =
  process.env['REFLECT_MIGRATIONS_DIR'] ??
  fileURLToPath(new URL('../../../crates/index-schema/migrations', import.meta.url))
if (!existsSync(migrationsDir)) {
  throw new Error(`index migrations not found at ${migrationsDir}`)
}

const files = createFsFileStore(config.graphDir)
const index = createServerIndexDb(path.join(config.dataDir, 'index.db'), migrationsDir)
const router = createBridgeRouter(config, files, index)
const auth = createSessionAuth(config.password, config.agentToken)

const webDistDirRaw =
  process.env['REFLECT_WEB_DIST'] ?? fileURLToPath(new URL('../../desktop/dist', import.meta.url))
const webDistDir = existsSync(path.join(webDistDirRaw, 'index.html')) ? webDistDirRaw : null

const app = createApp(config, auth, router, webDistDir)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.info(`[reflect-server] graph:  ${config.graphDir}`)
  console.info(`[reflect-server] index:  ${path.join(config.dataDir, 'index.db')}`)
  console.info(`[reflect-server] web:    ${webDistDir ?? '(not built — use the Vite dev proxy)'}`)
  console.info(`[reflect-server] agent:  ${config.agentToken === null ? 'no token set' : 'bearer token enabled'}`)
  console.info(`[reflect-server] http://localhost:${info.port} (login at /login)`)
})
