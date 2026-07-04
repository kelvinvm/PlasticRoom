import { describe, expect, it } from 'vitest'
import { formatBytes, formatDimensions, formatPrintTime, tagColor } from './format'

describe('formatters', () => {
  it('formats bytes into human units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5_242_880)).toBe('5.0 MB')
  })

  it('formats dimensions, or null when any axis is missing', () => {
    expect(formatDimensions(12.5, 8, 3.25)).toBe('12.5 × 8 × 3.25 mm')
    expect(formatDimensions(10, null, 3)).toBeNull()
  })

  it('formats print time, or null when missing', () => {
    expect(formatPrintTime(45)).toBe('45m')
    expect(formatPrintTime(60)).toBe('1h')
    expect(formatPrintTime(125)).toBe('2h 5m')
    expect(formatPrintTime(null)).toBeNull()
  })

  it('maps colorKey to a color with a brass fallback', () => {
    expect(tagColor('green')).toBe('#3ddc97')
    expect(tagColor(null)).toBe('#dbb55a')
    expect(tagColor('unknown')).toBe('#dbb55a')
  })
})
