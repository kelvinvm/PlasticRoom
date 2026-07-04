import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fileTypeFromName, dimsFromGeometry } from './thumbnail'

describe('fileTypeFromName', () => {
  it('recognizes .stl and .3mf case-insensitively', () => {
    expect(fileTypeFromName('Widget.STL')).toBe('Stl')
    expect(fileTypeFromName('plate.3mf')).toBe('ThreeMf')
  })
  it('returns null for anything else', () => {
    expect(fileTypeFromName('notes.txt')).toBeNull()
    expect(fileTypeFromName('noextension')).toBeNull()
  })
})

describe('dimsFromGeometry', () => {
  it('returns the bounding-box size in x/y/z', () => {
    const geometry = new THREE.BoxGeometry(4, 2, 6) // width, height, depth
    const dims = dimsFromGeometry(geometry)
    expect(dims.x).toBeCloseTo(4)
    expect(dims.y).toBeCloseTo(2)
    expect(dims.z).toBeCloseTo(6)
  })
})
