import { mkdirSync } from 'node:fs'
import path from 'node:path'

/** Everything the server reads from the environment, resolved and validated. */
export interface ServerConfig {
  /** Absolute path of the graph folder (markdown source of truth). */
  graphDir: string
  /** Display name the graph reports to clients (default: folder basename). */
  graphName: string
  /** Server-owned state (index db, settings, secrets) — not part of the graph. */
  dataDir: string
  port: number
  /** The single-user login password. */
  password: string
  /** Optional bearer token for agent/API access (REST and MCP clients). */
  agentToken: string | null
  /** Mark session cookies `Secure` (set behind an HTTPS proxy). */
  secureCookies: boolean
}

/**
 * Load configuration from the environment. `REFLECT_GRAPH_DIR` and
 * `REFLECT_PASSWORD` are required — a notes server with a guessable default
 * password or an accidental graph location helps nobody; fail at boot instead.
 */
export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const graphDirRaw = env['REFLECT_GRAPH_DIR']
  if (graphDirRaw === undefined || graphDirRaw === '') {
    throw new Error('REFLECT_GRAPH_DIR is required (the folder your markdown notes live in)')
  }
  const password = env['REFLECT_PASSWORD']
  if (password === undefined || password.length < 4) {
    throw new Error('REFLECT_PASSWORD is required (4 characters minimum)')
  }
  if (password.length < 12) {
    console.warn(
      '[reflect-server] REFLECT_PASSWORD is short — login is rate-limited, but a longer passphrase is safer on a public host',
    )
  }

  const graphDir = path.resolve(graphDirRaw)
  const dataDir = path.resolve(env['REFLECT_DATA_DIR'] ?? path.join(graphDir, '.reflect', 'server'))

  // The graph contract: daily/, notes/, assets/ always exist (graph_open
  // "ensures the standard layout" natively; the server does it at boot).
  for (const dir of ['daily', 'notes', 'assets', 'audio-memos']) {
    mkdirSync(path.join(graphDir, dir), { recursive: true })
  }
  mkdirSync(dataDir, { recursive: true })

  const agentToken = env['REFLECT_AGENT_TOKEN']
  return {
    graphDir,
    graphName: env['REFLECT_GRAPH_NAME'] ?? path.basename(graphDir),
    dataDir,
    port: Number(env['PORT'] ?? 8787),
    password,
    agentToken: agentToken === undefined || agentToken === '' ? null : agentToken,
    secureCookies: env['REFLECT_SECURE_COOKIES'] === '1',
  }
}
