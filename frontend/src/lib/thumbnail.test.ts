import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fileTypeFromName, dimsFromObject } from './thumbnail'

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

describe('dimsFromObject', () => {
  it('returns the bounding-box size of a single mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 6))
    const dims = dimsFromObject(mesh)
    expect(dims.x).toBeCloseTo(4)
    expect(dims.y).toBeCloseTo(2)
    expect(dims.z).toBeCloseTo(6)
  })

  it('spans multiple meshes in WORLD space, honoring their transforms', () => {
    // Two identical 10mm boxes; one shifted +100 on x. World extent is -5..105 = 110.
    // The old local-space merge would wrongly report ~10 (both centered at local origin).
    const group = new THREE.Group()
    const a = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10))
    const b = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10))
    b.position.set(100, 0, 0)
    group.add(a, b)
    group.updateMatrixWorld(true)
    const dims = dimsFromObject(group)
    expect(dims.x).toBeCloseTo(110)
    expect(dims.y).toBeCloseTo(10)
    expect(dims.z).toBeCloseTo(10)
  })
})
