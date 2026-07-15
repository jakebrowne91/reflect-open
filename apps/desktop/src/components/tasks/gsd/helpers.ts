/** Small helpers ported from Kan's ~/utils/helpers, used by the board port. */

export function getInitialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    return ''
  }
  if (parts.length === 1) {
    return (parts[0] ?? '').slice(0, 2).toUpperCase()
  }
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase()
}

export function inferInitialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  return local.slice(0, 2).toUpperCase()
}

/** Avatar image URL passthrough (Kan resolves storage URLs; the port uses them as-is). */
export function getAvatarUrl(image: string): string {
  return image
}
