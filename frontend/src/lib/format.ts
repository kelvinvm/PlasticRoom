export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export function formatDimensions(
  x: number | null,
  y: number | null,
  z: number | null,
): string | null {
  if (x === null || y === null || z === null) {
    return null
  }
  const trim = (n: number) => Number(n.toFixed(2)).toString()
  return `${trim(x)} × ${trim(y)} × ${trim(z)} mm`
}

export function formatPrintTime(minutes: number | null): string | null {
  if (minutes === null) {
    return null
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) {
    return `${mins}m`
  }
  if (mins === 0) {
    return `${hours}h`
  }
  return `${hours}h ${mins}m`
}

const TAG_COLORS: Record<string, string> = {
  brass: '#dbb55a',
  orange: '#ff8a3d',
  green: '#3ddc97',
  red: '#e0654a',
}

export const TAG_COLOR_KEYS = ['brass', 'orange', 'green', 'red'] as const

export function tagColor(colorKey: string | null): string {
  if (colorKey && TAG_COLORS[colorKey]) {
    return TAG_COLORS[colorKey]
  }
  return TAG_COLORS.brass
}
