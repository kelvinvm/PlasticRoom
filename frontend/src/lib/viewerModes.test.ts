// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyRenderMode,
  setActivePlate,
  setVisibleObjects,
  frameCameraToBox,
  boundsForObjects,
  PLATE_COLORS,
} from './viewerModes'

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

describe('setVisibleObjects', () => {
  it('shows only the objects whose index is listed', () => {
    const objs = meshObjects(4)
    setVisibleObjects(objs, [1, 3])
    expect(objs.map((o) => o.visible)).toEqual([false, true, false, true])
  })

  it('null shows every object', () => {
    const objs = meshObjects(3)
    setVisibleObjects(objs, [0])
    setVisibleObjects(objs, null)
    expect(objs.every((o) => o.visible)).toBe(true)
  })
})

describe('frameCameraToBox', () => {
  const FOV = 45

  function camera(aspect = 1): THREE.PerspectiveCamera {
    return new THREE.PerspectiveCamera(FOV, aspect, 0.1, 1000)
  }

  it('aims the camera and orbit target at the box center', () => {
    const cam = camera()
    const target = new THREE.Vector3()
    // center (5, 5, 5)
    const box = new THREE.Box3(new THREE.Vector3(4, 4, 4), new THREE.Vector3(6, 6, 6))

    frameCameraToBox(cam, target, box)

    expect(target.x).toBeCloseTo(5)
    expect(target.y).toBeCloseTo(5)
    expect(target.z).toBeCloseTo(5)
  })

  it('pulls back just far enough that the model nearly fills the frame', () => {
    const cam = camera(1)
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius

    frameCameraToBox(cam, new THREE.Vector3(), box)

    const distance = cam.position.distanceTo(new THREE.Vector3(0, 0, 0))
    const subtendedHalfAngle = Math.asin(radius / distance)
    const halfFov = THREE.MathUtils.degToRad(FOV) / 2
    // fills most of the frame, without spilling outside it
    expect(subtendedHalfAngle).toBeLessThanOrEqual(halfFov + 1e-6)
    expect(subtendedHalfAngle).toBeGreaterThan(halfFov * 0.8)
  })

  it('moves proportionally farther for a larger model', () => {
    const near = camera()
    const far = camera()
    const small = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
    const big = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2))

    frameCameraToBox(near, new THREE.Vector3(), small)
    frameCameraToBox(far, new THREE.Vector3(), big)

    expect(far.position.length() / near.position.length()).toBeCloseTo(2)
  })

  it('positions the camera along the requested viewing direction', () => {
    const cam = camera()
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))

    frameCameraToBox(cam, new THREE.Vector3(), box, new THREE.Vector3(0, 0, 1))

    expect(cam.position.x).toBeCloseTo(0)
    expect(cam.position.y).toBeCloseTo(0)
    expect(cam.position.z).toBeGreaterThan(0)
  })

  it('leaves the camera untouched for an empty box', () => {
    const cam = camera()
    cam.position.set(1, 2, 3)
    const target = new THREE.Vector3(9, 9, 9)

    frameCameraToBox(cam, target, new THREE.Box3())

    expect(cam.position.toArray()).toEqual([1, 2, 3])
    expect(target.toArray()).toEqual([9, 9, 9])
  })
})

describe('boundsForObjects', () => {
  // Three unit cubes spread along X: index 0 at x=0, index 1 far out at x=100, index 2 at x=20.
  function spreadCubes(): THREE.Mesh[] {
    const xs = [0, 100, 20]
    return xs.map((x) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
      mesh.position.set(x, 0, 0)
      return mesh
    })
  }

  it('encloses only the objects at the given indices', () => {
    const box = boundsForObjects(spreadCubes(), [0, 2])
    expect(box.min.x).toBeCloseTo(-0.5)
    expect(box.max.x).toBeCloseTo(20.5) // excludes index 1 at x=100
  })

  it('returns an empty box for out-of-range indices', () => {
    expect(boundsForObjects(spreadCubes(), [5]).isEmpty()).toBe(true)
  })

  it('returns an empty box for no indices', () => {
    expect(boundsForObjects(spreadCubes(), []).isEmpty()).toBe(true)
  })
})
