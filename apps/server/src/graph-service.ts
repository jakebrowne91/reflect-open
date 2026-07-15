import {
  appendBlock,
  buildIndexedNote,
  hashContent,
  parseNote,
  ReflectError,
  slugForTitle,
} from '@reflect/core'
import type { GraphFileStore } from './fs-file-store'
import type { ServerIndexDb } from './index-db'

/**
 * The agent-facing view of the graph — one service behind both the REST
 * routes and the MCP tools, so the two surfaces cannot drift.
 *
 * Two contracts distinguish this from the raw bridge surface:
 *
 * 1. **Privacy.** Upstream's hard rule is that `private: true` notes never
 *    reach an external service; an agent is one. Private notes are invisible
 *    here — excluded from lists, search, and tasks, and unreadable/unwritable
 *    by path — even though the same bearer token could reach them through
 *    `/api/invoke`. That endpoint exists for the app; agents get this one.
 * 2. **Server-side indexing.** The browser app computes index projections
 *    client-side; agents don't run core. Every write here parses and indexes
 *    the note immediately, so search/backlinks/tasks stay fresh without a
 *    browser in the loop.
 */
export interface GraphService {
  listNotes: () => NoteSummary[]
  readNote: (path: string) => Promise<{ path: string; contents: string }>
  writeNote: (path: string, contents: string) => Promise<{ path: string; modifiedMs: number }>
  createNote: (input: {
    path?: string | undefined
    title?: string | undefined
    contents: string
  }) => Promise<{ path: string; modifiedMs: number }>
  deleteNote: (path: string) => Promise<void>
  moveNote: (from: string, to: string) => Promise<void>
  search: (query: string, limit?: number) => SearchHit[]
  today: () => { path: string; contents: string | null }
  appendToday: (text: string) => Promise<{ path: string; modifiedMs: number }>
  openTasks: () => OpenTaskRow[]
}

export interface NoteSummary {
  path: string
  title: string
  kind: string
  dailyDate: string | null
  modifiedMs: number
}

export interface SearchHit {
  path: string
  title: string
  snippet: string
}

export interface OpenTaskRow {
  notePath: string
  noteTitle: string
  text: string
  dueDate: string | null
}

/** Local calendar date, YYYY-MM-DD (the server's timezone; see readme). */
function todayStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Quote each term so user input can't break FTS5 query syntax. */
function ftsQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replaceAll('"', '')}"`)
    .join(' ')
}

export function createGraphService(
  files: GraphFileStore,
  index: ServerIndexDb,
): GraphService {
  /** Parse + project + apply: the write-side indexing pass. */
  async function indexContents(path: string, contents: string, mtime: number): Promise<void> {
    const parsed = parseNote({ path, source: contents })
    const fileHash = await hashContent(contents)
    index.applyNote(buildIndexedNote(parsed, { fileHash, mtime, source: contents }))
  }

  /**
   * The privacy gate. Prefers the indexed flag; a file the index hasn't seen
   * yet is parsed directly so a just-written `private: true` can't leak
   * through the gap before its projection lands.
   */
  function assertVisible(path: string): void {
    const row = index
      .query('SELECT is_private FROM notes WHERE path = ?', [path])
      .at(0)
    if (row !== undefined) {
      if (Number(row['is_private']) !== 0) {
        throw new ReflectError('notFound', `no such note: ${path}`)
      }
      return
    }
    const contents = files.read(path)
    if (contents !== null && parseNote({ path, source: contents }).frontmatter.private) {
      throw new ReflectError('notFound', `no such note: ${path}`)
    }
  }

  const readNote = async (path: string): Promise<{ path: string; contents: string }> => {
    assertVisible(path)
    const contents = files.read(path)
    if (contents === null) {
      throw new ReflectError('notFound', `no such note: ${path}`)
    }
    return { path, contents }
  }

  const writeNote = async (
    path: string,
    contents: string,
  ): Promise<{ path: string; modifiedMs: number }> => {
    assertVisible(path)
    const modifiedMs = files.write(path, contents)
    await indexContents(path, contents, modifiedMs)
    return { path, modifiedMs }
  }

  return {
    listNotes: () =>
      index
        .query(
          `SELECT path, title, kind, daily_date, mtime FROM notes
           WHERE is_private = 0 ORDER BY mtime DESC`,
          [],
        )
        .map((row) => ({
          path: String(row['path']),
          title: String(row['title']),
          kind: String(row['kind']),
          dailyDate: row['daily_date'] === null ? null : String(row['daily_date']),
          modifiedMs: Number(row['mtime']),
        })),

    readNote,
    writeNote,

    createNote: async ({ path, title, contents }) => {
      const target =
        path ?? (title !== undefined ? `notes/${slugForTitle(title)}.md` : undefined)
      if (target === undefined) {
        throw new ReflectError('parse', 'createNote needs a path or a title')
      }
      const outcome = files.create(target, contents)
      if (outcome.kind === 'collision') {
        throw new ReflectError('io', `a note already exists at ${target}`)
      }
      const modifiedMs = outcome.modifiedMs ?? Date.now()
      await indexContents(target, contents, modifiedMs)
      return { path: target, modifiedMs }
    },

    deleteNote: async (path) => {
      assertVisible(path)
      if (!files.exists(path)) {
        throw new ReflectError('notFound', `no such note: ${path}`)
      }
      files.remove(path)
      index.removeNote(path)
    },

    moveNote: async (from, to) => {
      assertVisible(from)
      if (!files.exists(from)) {
        throw new ReflectError('notFound', `cannot move note: ${from} does not exist`)
      }
      if (files.exists(to)) {
        throw new ReflectError('io', `cannot move note: ${to} already exists`)
      }
      index.moveNote(from, to)
      files.move(from, to)
    },

    search: (query, limit = 20) => {
      const match = ftsQuery(query)
      if (match === '') {
        return []
      }
      return index
        .query(
          `SELECT s.path AS path, n.title AS title,
                  snippet(search_fts, 2, '**', '**', '…', 12) AS snippet
           FROM search_fts s JOIN notes n ON n.path = s.path
           WHERE search_fts MATCH ? AND n.is_private = 0
           ORDER BY rank LIMIT ?`,
          [match, Math.min(Math.max(limit, 1), 100)],
        )
        .map((row) => ({
          path: String(row['path']),
          title: String(row['title']),
          snippet: String(row['snippet']),
        }))
    },

    today: () => {
      const path = `daily/${todayStamp()}.md`
      return { path, contents: files.read(path) }
    },

    appendToday: async (text) => {
      const path = `daily/${todayStamp()}.md`
      const existing = files.read(path) ?? ''
      return writeNote(path, appendBlock(existing, text))
    },

    openTasks: () =>
      index
        .query(
          `SELECT t.note_path, t.text, t.due_date, n.title FROM tasks t
           JOIN notes n ON n.path = t.note_path
           WHERE t.checked = 0 AND n.is_private = 0
           ORDER BY t.due_date IS NULL, t.due_date, n.mtime DESC`,
          [],
        )
        .map((row) => ({
          notePath: String(row['note_path']),
          noteTitle: String(row['title']),
          text: String(row['text']),
          dueDate: row['due_date'] === null ? null : String(row['due_date']),
        })),
  }
}
