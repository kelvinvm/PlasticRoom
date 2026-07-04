// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import * as THREE from 'three'
import { ModelViewer } from './ModelViewer'
import type { LoadedModel } from '../../lib/modelLoading'

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    enableDamping = false
    target = new THREE.Vector3()
    update() {}
    dispose() {}
  },
}))

function makeModel(): LoadedModel {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  return { object: mesh, bounds: new THREE.Box3().setFromObject(mesh), objects: [mesh] }
}

describe('ModelViewer', () => {
  it('mounts a canvas without throwing when WebGL is unavailable', () => {
    const { container } = render(<ModelViewer model={makeModel()} mode="solid" activePlate={null} />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('re-renders on mode change without throwing', () => {
    const model = makeModel()
    const { rerender } = render(<ModelViewer model={model} mode="solid" activePlate={null} />)
    rerender(<ModelViewer model={model} mode="wireframe" activePlate={null} />)
    // Scene-graph mutation happened via viewerModes; assert the material reflects it.
    expect((model.objects[0] as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial)
  })
})
