import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { ReflectError, type FileMeta, type NoteCreateOutcome } from '@reflect/core'

/**
 * The server's filesystem: the same store contract the in-browser dev bridge
 * fakes (`apps/desktop/src/dev/dev-file-store.ts`), backed by the real graph
 * folder. Paths crossing this interface are graph-relative POSIX paths
 * (`daily/2026-07-15.md`); every one is resolved inside the graph root or
 * rejected — the network client on the other side of the bridge is
 * authenticated, but a traversal bug must still be structurally impossible.
 */
export interface GraphFileStore {
  /** Every markdown note under `daily/` and `notes/` (the `list_files` view). */
  list: () => FileMeta[]
  /** Files under a graph-relative directory prefix (the `dir_list` view). */
  listDir: (dir: string) => FileMeta[]
  /** A note's markdown, or `null` when the path doesn't exist. */
  read: (relPath: string) => string | null
  exists: (relPath: string) => boolean
  /** Write a file and return the `modifiedMs` it was stamped with. */
  write: (relPath: string, contents: string) => number
  /** Create a file only when its path is free; never replaces existing bytes. */
  create: (relPath: string, contents: string) => NoteCreateOutcome
  /** Delete a path; a missing path is a no-op (mirrors trashing semantics). */
  remove: (relPath: string) => void
  /** Rename a file; refuses (returns false) when the destination exists. */
  move: (from: string, to: string) => boolean
  /** Raw bytes of an asset, or `null` when missing. */
  readBinary: (relPath: string) => Buffer | null
  writeBinary: (relPath: string, contents: Buffer) => void
}

/** Resolve a graph-relative path inside `root`, rejecting escapes loudly. */
function resolveInside(root: string, relPath: string): string {
  if (relPath === '' || path.posix.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) {
    throw new ReflectError('traversal', `not a graph-relative path: ${relPath}`)
  }
  if (relPath.split('/').includes('..')) {
    throw new ReflectError('traversal', `path escapes the graph: ${relPath}`)
  }
  const resolved = path.resolve(root, relPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ReflectError('traversal', `path escapes the graph: ${relPath}`)
  }
  return resolved
}

/** Recursively collect files under `dir`, returning graph-relative metas. */
function walk(root: string, dir: string, out: FileMeta[]): void {
  const absolute = path.join(root, dir)
  if (!existsSync(absolute)) {
    return
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    // Dotfiles (.reflect, .git, .DS_Store) are infrastructure, never notes.
    if (entry.name.startsWith('.')) {
      continue
    }
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(root, rel, out)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const stat = statSync(path.join(root, rel))
    out.push({ path: rel, size: stat.size, modifiedMs: Math.round(stat.mtimeMs) })
  }
}

/** Create the graph store rooted at `graphDir` (absolute, already existing). */
export function createFsFileStore(graphDir: string): GraphFileStore {
  const root = path.resolve(graphDir)

  const write = (relPath: string, contents: string): number => {
    const absolute = resolveInside(root, relPath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents, 'utf8')
    return Math.round(statSync(absolute).mtimeMs)
  }

  return {
    list: () => {
      const out: FileMeta[] = []
      walk(root, 'daily', out)
      walk(root, 'notes', out)
      return out.filter((file) => file.path.endsWith('.md'))
    },
    listDir: (dir) => {
      resolveInside(root, dir) // validation only: reject escapes before walking
      const out: FileMeta[] = []
      walk(root, path.posix.normalize(dir), out)
      return out
    },
    read: (relPath) => {
      const absolute = resolveInside(root, relPath)
      return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
    },
    exists: (relPath) => existsSync(resolveInside(root, relPath)),
    write,
    create: (relPath, contents) => {
      const absolute = resolveInside(root, relPath)
      if (existsSync(absolute)) {
        return { kind: 'collision' }
      }
      return { kind: 'created', modifiedMs: write(relPath, contents) }
    },
    remove: (relPath) => {
      rmSync(resolveInside(root, relPath), { force: true })
    },
    move: (from, to) => {
      const source = resolveInside(root, from)
      const destination = resolveInside(root, to)
      if (!existsSync(source) || existsSync(destination)) {
        return false
      }
      mkdirSync(path.dirname(destination), { recursive: true })
      renameSync(source, destination)
      return true
    },
    readBinary: (relPath) => {
      const absolute = resolveInside(root, relPath)
      return existsSync(absolute) ? readFileSync(absolute) : null
    },
    writeBinary: (relPath, contents) => {
      const absolute = resolveInside(root, relPath)
      mkdirSync(path.dirname(absolute), { recursive: true })
      writeFileSync(absolute, contents)
    },
  }
}
