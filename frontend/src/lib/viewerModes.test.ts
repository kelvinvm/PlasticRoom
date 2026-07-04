// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyRenderMode, setActivePlate, PLATE_COLORS } from './viewerModes'

function meshObjects(n: number): THREE.Mesh[] {
  return Array.from({ length: n }, () =>
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff })),
  )
}

describe('applyRenderMode', () => {
  it('solid clears wireframe on every material', () => {
    const objs = meshObjects(2)
    applyRenderMode(objs, 'wireframe')
    applyRenderMode(objs, 'solid')
    for (const o of objs) {
      expect(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe).toBe(false)
    }
  })

  it('wireframe sets wireframe on every material', () => {
    const objs = meshObjects(2)
    applyRenderMode(objs, 'wireframe')
    for (const o of objs) {
      expect(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe).toBe(true)
    }
  })

  it('plates tints each build-item a distinct color from PLATE_COLORS', () => {
    const objs = meshObjects(2)
    applyRenderMode(objs, 'plates')
    const c0 = ((objs[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()
    const c1 = ((objs[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()
    expect(c0).toBe(PLATE_COLORS[0])
    expect(c1).toBe(PLATE_COLORS[1])
    expect(c0).not.toBe(c1)
  })
})

describe('applyRenderMode with non-MeshStandardMaterial materials', () => {
  it('handles MeshPhongMaterial as built by ThreeMFLoader for non-PBR 3MF materials', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xffffff }))

    applyRenderMode([mesh], 'wireframe')
    expect((mesh.material as THREE.MeshPhongMaterial).wireframe).toBe(true)

    applyRenderMode([mesh], 'plates')
    expect((mesh.material as THREE.MeshPhongMaterial).color.getHex()).toBe(PLATE_COLORS[0])
  })
})

describe('setActivePlate', () => {
  it('hides all but the active index', () => {
    const objs = meshObjects(3)
    setActivePlate(objs, 1)
    expect(objs[0].visible).toBe(false)
    expect(objs[1].visible).toBe(true)
    expect(objs[2].visible).toBe(false)
  })

  it('null shows every object', () => {
    const objs = meshObjects(3)
    setActivePlate(objs, 1)
    setActivePlate(objs, null)
    expect(objs.every((o) => o.visible)).toBe(true)
  })
})
