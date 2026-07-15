import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import DatabaseConstructor, { type Database } from 'better-sqlite3'
import { encodeTaskBreadcrumbs, ReflectError, type IndexedNote } from '@reflect/core'

/**
 * The server's SQLite index: the real `crates/index-schema` migrations on
 * better-sqlite3, mirroring the in-browser dev index
 * (`apps/desktop/src/dev/dev-index-db.ts`) statement-for-statement — which in
 * turn mirrors Rust's `src-tauri/src/db/write.rs`. Unlike the dev index this
 * one persists across restarts, so migrations track `PRAGMA user_version`
 * (the count applied so far; upstream's migration list is append-only).
 */
export interface ServerIndexDb {
  /** Execute a read query (the `db_query` contract): rows as column-keyed objects. */
  query: (sql: string, params: readonly unknown[]) => Record<string, unknown>[]
  /** Replace all rows for `note.path` with its projection (`index_apply`). */
  applyNote: (note: IndexedNote) => void
  /** Drop every row belonging to `path` (`index_remove`). */
  removeNote: (path: string) => void
  /** Re-key every row from `from` to `to` (`index_move`); throws when `to` is occupied. */
  moveNote: (from: string, to: string) => void
  /** Re-stamp a row's `mtime`/`updated_at` (one `index_touch` entry). */
  touchNote: (path: string, mtime: number) => void
  /** Wipe derived tables, preserving `index_meta` (`index_clear`). */
  clear: () => void
  /** Upsert one `index_meta` key (`index_meta_set`). */
  setMeta: (key: string, value: string) => void
  /** Upsert one chat turn + its conversation row (`chat_message_save`). */
  saveChatMessage: (conversation: ChatConversation, message: ChatMessageRow) => void
  /** Delete a conversation; its messages cascade (`chat_conversation_delete`). */
  deleteChatConversation: (id: string) => void
}

/** Mirrors `chat_write.rs`'s `ChatConversation` (camelCased over IPC). */
export interface ChatConversation {
  id: string
  title: string
  createdMs: number
  updatedMs: number
}

/** Mirrors `chat_write.rs`'s `ChatMessageRow`: the JSON columns stay opaque strings. */
export interface ChatMessageRow {
  id: string
  conversationId: string
  userText: string
  attachments: string
  parts: string
  responseMessages: string
  createdMs: number
}

/**
 * `vec0` is the sqlite-vec native extension, not loaded here (yet). Semantic
 * search is off by default; a plain single-column table keeps the DDL — and
 * 0003's copy-and-drop migration dance — valid without the module.
 */
function stubVectorTables(sql: string): string {
  return sql.replace(
    /CREATE VIRTUAL TABLE (\S+) USING vec0\([^)]*\)/g,
    'CREATE TABLE $1 (embedding BLOB)',
  )
}

/** Coerce a bound parameter to something better-sqlite3 can bind (mirrors `json_to_sql`). */
function bindValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
    return value
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value)
  }
  return JSON.stringify(value)
}

function run(db: Database, sql: string, params: readonly unknown[] = []): void {
  db.prepare(sql).run(...params.map(bindValue))
}

function removeNoteRows(db: Database, notePath: string): void {
  run(db, 'DELETE FROM notes WHERE path = ?', [notePath])
  run(db, 'DELETE FROM search_fts WHERE path = ?', [notePath])
}

/** Apply any unapplied migrations from `migrationsDir`, tracked by user_version. */
function migrate(db: Database, migrationsDir: string): void {
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
  const appliedRaw = db.pragma('user_version', { simple: true })
  const applied = typeof appliedRaw === 'number' ? appliedRaw : 0
  for (const name of migrations.slice(applied)) {
    db.exec(stubVectorTables(readFileSync(path.join(migrationsDir, name), 'utf8')))
  }
  db.pragma(`user_version = ${migrations.length}`)
}

/** Open (or create) the index database at `dbPath` and bring it up to date. */
export function createServerIndexDb(dbPath: string, migrationsDir: string): ServerIndexDb {
  const db = new DatabaseConstructor(dbPath)
  db.pragma('journal_mode = WAL')
  // The schema relies on ON DELETE CASCADE (removing a `notes` row clears its
  // child tables); SQLite ships with foreign keys off per connection.
  db.pragma('foreign_keys = ON')
  migrate(db, migrationsDir)

  return {
    query: (sql, params) => {
      const statement = db.prepare(sql)
      if (!statement.reader) {
        statement.run(...params.map(bindValue))
        return []
      }
      return statement.all(...params.map(bindValue)) as Record<string, unknown>[]
    },

    applyNote: (note) => {
      removeNoteRows(db, note.path)
      run(
        db,
        `INSERT INTO notes(path, id, title, title_key, kind, daily_date, is_private, is_pinned, pinned_order, has_conflict, gist_url, gist_stale, file_hash, mtime, updated_at, preview)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          note.path,
          note.id,
          note.title,
          note.titleKey,
          note.kind,
          note.dailyDate,
          note.isPrivate,
          note.isPinned,
          note.pinnedOrder,
          note.hasConflict,
          note.gistUrl,
          note.gistStale,
          note.fileHash,
          note.mtime,
          note.mtime,
          note.preview,
        ],
      )
      run(db, 'INSERT INTO note_text(note_path, text) VALUES(?, ?)', [note.path, note.text])
      for (const link of note.links) {
        run(
          db,
          `INSERT INTO links(source_path, kind, target_raw, target_key, alias, pos_from, pos_to)
           VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [note.path, link.kind, link.targetRaw, link.targetKey, link.alias, link.posFrom, link.posTo],
        )
      }
      for (const tag of note.tags) {
        run(db, 'INSERT INTO tags(note_path, tag, tag_key) VALUES(?, ?, ?)', [
          note.path,
          tag.tag,
          tag.tagKey,
        ])
      }
      for (const alias of note.aliases) {
        run(db, 'INSERT INTO aliases(note_path, alias, alias_key) VALUES(?, ?, ?)', [
          note.path,
          alias.alias,
          alias.aliasKey,
        ])
      }
      for (const email of note.emails) {
        run(db, 'INSERT INTO note_emails(note_path, email, email_key) VALUES(?, ?, ?)', [
          note.path,
          email.email,
          email.emailKey,
        ])
      }
      for (const asset of note.assets) {
        run(db, 'INSERT INTO assets(note_path, asset_path) VALUES(?, ?)', [note.path, asset])
      }
      for (const task of note.tasks) {
        run(
          db,
          'INSERT INTO tasks(note_path, marker_offset, text, breadcrumbs, raw, checked, due_date) VALUES(?, ?, ?, ?, ?, ?, ?)',
          [
            note.path,
            task.markerOffset,
            task.text,
            encodeTaskBreadcrumbs(task.breadcrumbs),
            task.raw,
            task.checked,
            task.dueDate,
          ],
        )
      }
      const searchBody = note.assetText === '' ? note.text : `${note.text}\n${note.assetText}`
      run(db, 'INSERT INTO search_fts(path, title, body) VALUES(?, ?, ?)', [
        note.path,
        note.title,
        searchBody,
      ])
    },

    removeNote: (notePath) => removeNoteRows(db, notePath),

    moveNote: (from, to) => {
      const occupied = db.prepare('SELECT 1 FROM notes WHERE path = ?').get(to)
      if (occupied !== undefined) {
        throw new ReflectError('io', `cannot move note: ${to} is already indexed`)
      }
      // Mirrors the Rust caller: the child tables reference `notes(path)`, so
      // the parent-key update needs deferred FK checks — which only apply
      // inside a transaction (the pragma resets at COMMIT).
      db.exec('BEGIN')
      try {
        db.pragma('defer_foreign_keys = ON')
        run(db, 'UPDATE notes SET path = ? WHERE path = ?', [to, from])
        run(db, 'UPDATE note_text SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE links SET source_path = ? WHERE source_path = ?', [to, from])
        run(db, 'UPDATE tags SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE aliases SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE note_emails SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE assets SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE tasks SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE embedding_chunks SET note_path = ? WHERE note_path = ?', [to, from])
        run(db, 'UPDATE search_fts SET path = ? WHERE path = ?', [to, from])
        db.exec('COMMIT')
      } catch (cause) {
        db.exec('ROLLBACK')
        throw cause
      }
    },

    touchNote: (notePath, mtime) => {
      run(db, 'UPDATE notes SET mtime = ?, updated_at = ? WHERE path = ?', [
        mtime,
        mtime,
        notePath,
      ])
    },

    clear: () => {
      db.exec(
        `DELETE FROM notes; DELETE FROM search_fts;
         DELETE FROM embedding_vectors; DELETE FROM embedding_chunks;`,
      )
    },

    setMeta: (key, value) => {
      run(
        db,
        'INSERT INTO index_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      )
    },

    // The chat writes mirror `chat_write.rs` statement-for-statement: the
    // conversation keeps its original title/created_ms and bumps updated_ms,
    // seq is assigned inside the insert (never by the caller), and the
    // message upserts by primary key — deliberately not INSERT OR REPLACE.
    saveChatMessage: (conversation, message) => {
      run(
        db,
        `INSERT INTO chat_conversations(id, title, created_ms, updated_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_ms = excluded.updated_ms`,
        [conversation.id, conversation.title, conversation.createdMs, conversation.updatedMs],
      )
      run(
        db,
        `INSERT INTO chat_messages(
            id, conversation_id, seq, user_text, attachments, parts,
            response_messages, created_ms)
         VALUES (
            ?, ?,
            (SELECT COALESCE(MAX(seq) + 1, 0) FROM chat_messages WHERE conversation_id = ?),
            ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            user_text = excluded.user_text,
            attachments = excluded.attachments,
            parts = excluded.parts,
            response_messages = excluded.response_messages`,
        [
          message.id,
          message.conversationId,
          message.conversationId,
          message.userText,
          message.attachments,
          message.parts,
          message.responseMessages,
          message.createdMs,
        ],
      )
    },

    deleteChatConversation: (id) => {
      run(db, 'DELETE FROM chat_conversations WHERE id = ?', [id])
    },
  }
}
