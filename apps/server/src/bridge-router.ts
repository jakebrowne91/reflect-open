import path from 'node:path'
import { indexedNoteSchema, ReflectError } from '@reflect/core'
import { z } from 'zod'
import { createJsonStore } from './json-store'
import type { ServerConfig } from './config'
import type { GraphFileStore } from './fs-file-store'
import type { ServerIndexDb } from './index-db'

/**
 * The server-side command router: the same surface the in-browser dev bridge
 * (`apps/desktop/src/dev/dev-bridge.ts`) fakes, answered from the real graph
 * folder and the persistent SQLite index. One instance serves every
 * authenticated client — browser tabs and agents alike — so the graph has a
 * single writer process and SQLite serializes it.
 *
 * Anything unimplemented rejects loudly with the command name — a surface
 * quietly rendering empty because a stub answered wrong is worse than an
 * error naming the gap.
 */
export interface BridgeRouter {
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>
}

const dbQueryArgsSchema = z.object({ sql: z.string(), params: z.array(z.unknown()) })
const pathArgsSchema = z.object({ path: z.string() })
const writeArgsSchema = z.object({ path: z.string(), contents: z.string() })
const createArgsSchema = writeArgsSchema.extend({ generation: z.number().int().nonnegative() })
const moveArgsSchema = z.object({ from: z.string(), to: z.string() })
const metaArgsSchema = z.object({ key: z.string(), value: z.string() })
const touchArgsSchema = z.object({
  entries: z.array(z.object({ path: z.string(), mtime: z.number() })),
})
const applyArgsSchema = z.object({ note: indexedNoteSchema })
const applyBatchArgsSchema = z.object({ notes: z.array(indexedNoteSchema) })
const settingsArgsSchema = z.object({ settings: z.record(z.string(), z.unknown()) })
const secretNameArgsSchema = z.object({ name: z.string() })
const secretSetArgsSchema = z.object({ name: z.string(), value: z.string() })
const assetWriteArgsSchema = z.object({ path: z.string(), contentsBase64: z.string() })
const chatSaveArgsSchema = z.object({
  conversation: z.object({
    id: z.string(),
    title: z.string(),
    createdMs: z.number(),
    updatedMs: z.number(),
  }),
  message: z.object({
    id: z.string(),
    conversationId: z.string(),
    userText: z.string(),
    attachments: z.string(),
    parts: z.string(),
    responseMessages: z.string(),
    createdMs: z.number(),
  }),
})
const chatDeleteArgsSchema = z.object({ id: z.string() })

/** The single graph a server owns has one fixed generation (no switching). */
const GRAPH_GENERATION = 1

/** Mirrors `MTIME_TRUST_AGE_MS` in core's hash.ts and Rust's scan.rs. */
const MTIME_TRUST_AGE_MS = 5_000

const GIT_STATUS_UNINITIALIZED = {
  initialized: false,
  branch: null,
  remoteUrl: null,
  ahead: 0,
  behind: 0,
  inProgress: false,
}

export function createBridgeRouter(
  config: ServerConfig,
  files: GraphFileStore,
  index: ServerIndexDb,
): BridgeRouter {
  const graphInfo = {
    root: config.graphDir,
    name: config.graphName,
    generation: GRAPH_GENERATION,
  }
  const startedMs = Date.now()
  const settings = createJsonStore<Record<string, unknown>>(
    path.join(config.dataDir, 'settings.json'),
    { mobileOnboarded: true },
  )
  // Provider API keys land here. The desktop app keeps these in the OS
  // keychain; a headless server has no keychain, so this file is chmod 600
  // and lives in the data dir (never inside a git-synced graph).
  const secrets = createJsonStore<Record<string, string>>(
    path.join(config.dataDir, 'secrets.json'),
    {},
    { ownerOnly: true },
  )

  async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
    switch (command) {
      case 'app_version':
        return '0.1.0-server'
      case 'app_platform':
        // The remote bridge answers this client-side (a phone browser wants
        // the mobile tree); this is the fallback for direct API callers.
        return 'desktop'
      case 'background_task_begin':
      case 'background_task_end':
        return null
      case 'mobile_storage':
        return { localRoot: config.graphDir, icloudDocumentsRoot: null, icloudGraphRoots: [] }
      case 'mobile_storage_local':
        return config.graphDir
      case 'icloud_download_pending':
        return 0
      case 'graph_open':
      case 'graph_create':
        return graphInfo
      case 'recent_graphs':
        // The desktop boot path reopens the most recent graph; a server owns
        // exactly one, so it is always the list.
        return [{ root: config.graphDir, name: config.graphName, openedMs: startedMs }]
      case 'forget_recent':
      case 'capture_host_register':
      case 'watch_start':
      case 'watch_stop':
      case 'quit_confirm':
      case 'toggle_devtools':
      case 'close_note_windows':
      case 'asset_open':
        return null
      case 'capture_inbox_list':
        return []
      case 'capture_shared_inbox_relay':
        return 0

      case 'note_read': {
        const { path: notePath } = pathArgsSchema.parse(args)
        const contents = files.read(notePath)
        if (contents === null) {
          throw new ReflectError('notFound', `no such note: ${notePath}`)
        }
        return contents
      }
      case 'note_write': {
        const { path: notePath, contents } = writeArgsSchema.parse(args)
        return files.write(notePath, contents)
      }
      case 'note_create': {
        const { path: notePath, contents, generation } = createArgsSchema.parse(args)
        if (generation !== graphInfo.generation) {
          throw new ReflectError(
            'io',
            'the graph changed since this command was issued; dropping it',
          )
        }
        return files.create(notePath, contents)
      }
      case 'note_exists':
        return files.exists(pathArgsSchema.parse(args).path)
      case 'note_delete': {
        files.remove(pathArgsSchema.parse(args).path)
        return null
      }
      case 'list_files':
        return files.list()
      case 'dir_list':
        return files.listDir(z.object({ dir: z.string() }).parse(args).dir)
      case 'note_move_indexed': {
        const { from, to } = moveArgsSchema.parse(args)
        if (!files.exists(from)) {
          throw new ReflectError('notFound', `cannot move note: ${from} does not exist`)
        }
        if (files.exists(to)) {
          throw new ReflectError('io', `cannot move note: ${to} already exists`)
        }
        // Index first: it can refuse (occupied path), and a refused move must
        // leave the file untouched — the TS stand-in for Rust's
        // file+rows transaction.
        index.moveNote(from, to)
        files.move(from, to)
        return null
      }

      case 'asset_write': {
        const { path: assetPath, contentsBase64 } = assetWriteArgsSchema.parse(args)
        files.writeBinary(assetPath, Buffer.from(contentsBase64, 'base64'))
        return null
      }
      case 'asset_read': {
        const { path: assetPath } = pathArgsSchema.parse(args)
        const contents = files.readBinary(assetPath)
        if (contents === null) {
          throw new ReflectError('notFound', `asset not found: ${assetPath}`)
        }
        return contents.toString('base64')
      }

      case 'db_query': {
        const { sql, params } = dbQueryArgsSchema.parse(args)
        return index.query(sql, params)
      }
      case 'index_open':
        return GRAPH_GENERATION
      case 'index_apply': {
        index.applyNote(applyArgsSchema.parse(args).note)
        return null
      }
      case 'index_apply_batch': {
        for (const note of applyBatchArgsSchema.parse(args).notes) {
          index.applyNote(note)
        }
        return null
      }
      case 'index_remove': {
        index.removeNote(pathArgsSchema.parse(args).path)
        return null
      }
      case 'index_move': {
        const { from, to } = moveArgsSchema.parse(args)
        index.moveNote(from, to)
        return null
      }
      case 'index_touch': {
        for (const entry of touchArgsSchema.parse(args).entries) {
          index.touchNote(entry.path, entry.mtime)
        }
        return null
      }
      case 'index_reconcile_scan':
        return reconcileScan(files, index)
      case 'index_clear': {
        index.clear()
        return null
      }
      case 'index_meta_set': {
        const { key, value } = metaArgsSchema.parse(args)
        index.setMeta(key, value)
        return null
      }

      case 'settings_load':
        return settings.get()
      case 'settings_save': {
        settings.set(settingsArgsSchema.parse(args).settings)
        return null
      }
      case 'secret_get':
        return secrets.get()[secretNameArgsSchema.parse(args).name] ?? null
      case 'secret_set': {
        const { name, value } = secretSetArgsSchema.parse(args)
        secrets.set({ ...secrets.get(), [name]: value })
        return null
      }
      case 'secret_delete': {
        const { name } = secretNameArgsSchema.parse(args)
        const { [name]: _dropped, ...rest } = secrets.get()
        secrets.set(rest)
        return null
      }

      // Git backup is not wired up yet (the roadmap: the server owns the
      // repo and commits/pushes itself). Reporting "not initialized" keeps
      // the backup UI truthful — it shows backup as off rather than erroring.
      case 'git_status':
      case 'git_setup':
      case 'git_disconnect':
        return GIT_STATUS_UNINITIALIZED

      // Semantic search: not available server-side yet; `uninitialized` is
      // the honest idle state and stops the desktop tree's status poll from
      // rejecting.
      case 'embed_status':
        return { status: 'uninitialized' }

      case 'calendar_authorization_status':
      case 'contacts_authorization_status':
        return 'denied'
      case 'calendar_list_calendars':
      case 'calendar_list_events':
      case 'contacts_lookup_by_email':
      case 'contacts_lookup_by_name':
        return []

      case 'chat_message_save': {
        const { conversation, message } = chatSaveArgsSchema.parse(args)
        index.saveChatMessage(conversation, message)
        return null
      }
      case 'chat_conversation_delete': {
        index.deleteChatConversation(chatDeleteArgsSchema.parse(args).id)
        return null
      }

      default:
        console.error(`[server-bridge] unimplemented command "${command}"`)
        throw new ReflectError('unknown', `server bridge: unimplemented command "${command}"`)
    }
  }

  return { invoke }
}

/**
 * The `index_reconcile_scan` stand-in: the same listing-vs-rows comparison
 * `src-tauri/src/db/scan.rs` runs natively, over the real folder. Clients run
 * the actual reconcile (read changed files, push projections) themselves.
 */
function reconcileScan(files: GraphFileStore, index: ServerIndexDb) {
  const stored = new Map(
    index
      .query('SELECT path, mtime, file_hash FROM notes', [])
      .map((row) => [
        String(row['path']),
        { mtime: Number(row['mtime']), hash: String(row['file_hash']) },
      ]),
  )
  const now = Date.now()
  const listing = files.list()
  const onDisk = new Set(listing.map((file) => file.path))
  const candidates = []
  for (const file of listing) {
    const facts = stored.get(file.path)
    const settled = now - file.modifiedMs >= MTIME_TRUST_AGE_MS
    if (settled && facts !== undefined && facts.mtime === file.modifiedMs) {
      continue
    }
    candidates.push({
      path: file.path,
      modifiedMs: file.modifiedMs,
      storedMtime: facts?.mtime ?? null,
      storedHash: facts?.hash ?? null,
    })
  }
  const orphans = [...stored.entries()]
    .filter(([storedPath]) => !onDisk.has(storedPath))
    .map(([storedPath, facts]) => ({
      path: storedPath,
      storedMtime: facts.mtime,
      storedHash: facts.hash,
    }))
    .sort((first, second) => first.path.localeCompare(second.path))
  return { total: listing.length, candidates, orphans }
}
