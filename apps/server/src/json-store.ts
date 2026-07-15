import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * A tiny durable JSON document: read at construction, rewritten on every
 * mutation. Backs the settings document and the secrets map — call volumes
 * there are keystrokes-per-minute at worst, so rewrite-on-save is plenty.
 */
export interface JsonStore<T> {
  get: () => T
  set: (value: T) => void
}

export function createJsonStore<T>(
  filePath: string,
  fallback: T,
  options?: { ownerOnly?: boolean },
): JsonStore<T> {
  let value: T = fallback
  if (existsSync(filePath)) {
    try {
      value = JSON.parse(readFileSync(filePath, 'utf8')) as T
    } catch {
      // A corrupt store must not brick the server; start from the fallback
      // and the next save repairs the file.
      value = fallback
    }
  }
  return {
    get: () => value,
    set: (next) => {
      value = next
      writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      if (options?.ownerOnly === true) {
        chmodSync(filePath, 0o600)
      }
    },
  }
}
