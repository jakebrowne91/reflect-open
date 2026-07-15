import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { ReflectError } from '@reflect/core'

const execFileAsync = promisify(execFile)

/** Mirrors core's `gitStatusSchema`. */
export interface GitStatusShape {
  initialized: boolean
  branch: string | null
  remoteUrl: string | null
  ahead: number
  behind: number
  inProgress: boolean
}

/** Mirrors core's `commitOutcomeSchema`. */
export interface CommitOutcomeShape {
  committed: boolean
  sha: string | null
  ahead: number
  skippedLargeFiles: { path: string; size: number }[]
}

/** Mirrors core's `pushOutcomeSchema`. */
export interface PushOutcomeShape {
  pushed: boolean
  nonFastForward: boolean
  rejectionMessage: string | null
}

/** Mirrors core's `mergeOutcomeSchema` (fast-forward subset). */
export interface MergeOutcomeShape {
  kind: 'upToDate' | 'fastForward' | 'merged' | 'mergedWithConflicts'
  conflictedPaths: string[]
  changedFiles: { path: string; kind: 'upsert' | 'remove'; modifiedMs?: number }[]
}

/**
 * Server-side git backup: the graph folder is a git repository the server
 * commits on a debounce after every mutation and pushes whenever `origin`
 * exists. This replaces the desktop app's client-driven sync engine — the
 * server is the graph's single writer, so it owns the repository too.
 *
 * Authentication is ambient (the server process's git credentials: ssh-agent
 * or a credential helper), matching upstream's "if `ssh -T git@host` works,
 * sync works" contract. No remote configured simply means local history.
 */
export interface GitBackup {
  status: () => Promise<GitStatusShape>
  setup: (remoteUrl: string | null, branch: string | null) => Promise<GitStatusShape>
  disconnect: () => Promise<GitStatusShape>
  commitAll: (message: string) => Promise<CommitOutcomeShape>
  fetch: () => Promise<{ ahead: number; behind: number }>
  merge: () => Promise<MergeOutcomeShape>
  push: () => Promise<PushOutcomeShape>
  /** Called on every file mutation; schedules a debounced commit+push. */
  noteMutation: () => void
}

export function createGitBackup(
  graphDir: string,
  options?: { debounceMs?: number },
): GitBackup {
  const debounceMs = options?.debounceMs ?? 15_000
  let timer: NodeJS.Timeout | null = null
  let running: Promise<void> = Promise.resolve()
  let inProgress = false

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', graphDir, ...args])
    return stdout.trim()
  }

  async function gitOrNull(...args: string[]): Promise<string | null> {
    try {
      return await git(...args)
    } catch {
      return null
    }
  }

  async function ensureRepo(): Promise<void> {
    if (!existsSync(path.join(graphDir, '.git'))) {
      await git('init', '-b', 'main')
    }
    // Commits need an author identity, scoped to the repo rather than relying
    // on global config. This must run for a CLONED repo too (restore-on-boot),
    // not only a freshly init'd one — a clone carries no local identity, so
    // without this every commit fails silently ("tell me who you are") and the
    // backup stages changes it can never commit.
    if ((await gitOrNull('config', 'user.email')) === null) {
      await git('config', 'user.name', 'Reflect Server')
      await git('config', 'user.email', 'reflect-server@localhost')
    }
    // `.reflect/` is the rebuildable cache (index db, server state) — it must
    // never ride the backup. Belt-and-braces with the iCloud rule upstream.
    const gitignorePath = path.join(graphDir, '.gitignore')
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
    if (!existing.split('\n').some((line) => line.trim() === '.reflect/')) {
      writeFileSync(gitignorePath, `${existing.replace(/\n*$/, '\n')}.reflect/\n.DS_Store\n`)
    }
  }

  async function branchName(): Promise<string | null> {
    return gitOrNull('symbolic-ref', '--short', 'HEAD')
  }

  async function aheadBehind(): Promise<{ ahead: number; behind: number }> {
    const counts = await gitOrNull('rev-list', '--left-right', '--count', '@{upstream}...HEAD')
    if (counts === null) {
      return { ahead: 0, behind: 0 }
    }
    const [behindRaw, aheadRaw] = counts.split(/\s+/)
    return { ahead: Number(aheadRaw ?? 0), behind: Number(behindRaw ?? 0) }
  }

  const status = async (): Promise<GitStatusShape> => {
    if (!existsSync(path.join(graphDir, '.git'))) {
      return {
        initialized: false,
        branch: null,
        remoteUrl: null,
        ahead: 0,
        behind: 0,
        inProgress,
      }
    }
    const { ahead, behind } = await aheadBehind()
    return {
      initialized: true,
      branch: await branchName(),
      remoteUrl: await gitOrNull('remote', 'get-url', 'origin'),
      ahead,
      behind,
      inProgress,
    }
  }

  const commitAll = async (message: string): Promise<CommitOutcomeShape> => {
    await ensureRepo()
    await git('add', '-A')
    const staged = await gitOrNull('diff', '--cached', '--quiet')
    if (staged !== null) {
      // Exit 0 → nothing staged; the tree already matches HEAD (or the
      // unborn branch has nothing to commit).
      return { committed: false, sha: null, ahead: (await aheadBehind()).ahead, skippedLargeFiles: [] }
    }
    await git('commit', '-m', message)
    return {
      committed: true,
      sha: await git('rev-parse', 'HEAD'),
      ahead: (await aheadBehind()).ahead,
      skippedLargeFiles: [],
    }
  }

  const push = async (): Promise<PushOutcomeShape> => {
    const remote = await gitOrNull('remote', 'get-url', 'origin')
    const branch = await branchName()
    if (remote === null || branch === null) {
      return { pushed: false, nonFastForward: false, rejectionMessage: null }
    }
    try {
      await git('push', '-u', 'origin', branch)
      return { pushed: true, nonFastForward: false, rejectionMessage: null }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return {
        pushed: false,
        nonFastForward: message.includes('non-fast-forward') || message.includes('fetch first'),
        rejectionMessage: message,
      }
    }
  }

  async function backupNow(): Promise<void> {
    inProgress = true
    try {
      const outcome = await commitAll('reflect: backup')
      if (outcome.committed) {
        console.info(`[git-backup] committed ${outcome.sha?.slice(0, 8) ?? ''}`)
      }
      const pushed = await push()
      if (pushed.pushed) {
        console.info('[git-backup] pushed to origin')
      } else if (pushed.rejectionMessage !== null) {
        console.error(`[git-backup] push failed: ${pushed.rejectionMessage}`)
      }
    } catch (cause) {
      console.error('[git-backup] backup failed:', cause)
    } finally {
      inProgress = false
    }
  }

  return {
    status,
    commitAll,
    push,

    setup: async (remoteUrl, branch) => {
      await ensureRepo()
      if (remoteUrl !== null) {
        const existing = await gitOrNull('remote', 'get-url', 'origin')
        if (existing === null) {
          await git('remote', 'add', 'origin', remoteUrl)
        } else if (existing !== remoteUrl) {
          await git('remote', 'set-url', 'origin', remoteUrl)
        }
      }
      if (branch !== null && (await branchName()) !== branch) {
        await git('branch', '-m', branch)
      }
      return status()
    },

    disconnect: async () => {
      await gitOrNull('remote', 'remove', 'origin')
      return status()
    },

    fetch: async () => {
      await git('fetch', 'origin')
      return aheadBehind()
    },

    merge: async () => {
      const { behind } = await aheadBehind()
      if (behind === 0) {
        return { kind: 'upToDate', conflictedPaths: [], changedFiles: [] }
      }
      // The server is the graph's single writer, so the remote only diverges
      // when something else pushed to it. Fast-forward is the safe subset;
      // anything else needs a human (or a future three-way merge port).
      try {
        await git('merge', '--ff-only', '@{upstream}')
      } catch {
        throw new ReflectError(
          'io',
          'the backup remote has diverged from the server graph; merge it by hand',
        )
      }
      const diff = await git('diff', '--name-status', 'ORIG_HEAD..HEAD')
      const changedFiles = diff
        .split('\n')
        .filter((line) => line.length > 0)
        .flatMap((line): MergeOutcomeShape['changedFiles'] => {
          const [statusCode, filePath] = line.split('\t')
          if (statusCode === undefined || filePath === undefined) {
            return []
          }
          if (statusCode.startsWith('D')) {
            return [{ path: filePath, kind: 'remove' as const }]
          }
          const absolute = path.join(graphDir, filePath)
          return existsSync(absolute)
            ? [
                {
                  path: filePath,
                  kind: 'upsert' as const,
                  modifiedMs: Math.round(statSync(absolute).mtimeMs),
                },
              ]
            : []
        })
      return { kind: 'fastForward', conflictedPaths: [], changedFiles }
    },

    noteMutation: () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        // Serialize backups: a new run queues behind the current one.
        running = running.then(backupNow)
      }, debounceMs)
    },
  }
}

/** Decorate a file store so every mutation notifies the backup debounce. */
export function withMutationHook<T extends object>(store: T, onMutation: () => void): T {
  const mutating = new Set(['write', 'create', 'remove', 'move', 'writeBinary'])
  const wrapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(store)) {
    wrapped[key] =
      typeof value === 'function' && mutating.has(key)
        ? (...args: unknown[]) => {
            const result = (value as (...inner: unknown[]) => unknown)(...args)
            onMutation()
            return result
          }
        : value
  }
  return wrapped as T
}
