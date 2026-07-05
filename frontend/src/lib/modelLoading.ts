import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'

export type ModelFileType = 'ThreeMf' | 'Stl'

export type ModelDims = { x: number; y: number; z: number }

export interface LoadedModel {
  /** Root object to add to a scene (STL: the mesh; 3MF: the build group). */
  object: THREE.Object3D
  /** World-space bounding box, honoring baked build-item transforms. */
  bounds: THREE.Box3
  /** Top-level build-items ("plates"). One entry for STL / single-item 3MF. */
  objects: THREE.Object3D[]
}

export function fileTypeFromName(name: string): ModelFileType | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.stl')) return 'Stl'
  if (lower.endsWith('.3mf')) return 'ThreeMf'
  return null
}

// World-space bounding-box size, honoring the transforms the loader bakes into
// each mesh (3MF build items are positioned across the plate). Local-space
// bounds would ignore those transforms and misframe.
export function dimsFromObject(object: THREE.Object3D): ModelDims {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return { x: 0, y: 0, z: 0 }
  const size = new THREE.Vector3()
  box.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

// Loads model bytes into a THREE object plus its world-space bounds and the
// list of top-level build-items. Pure JS but not unit-asserted (needs the
// loaders' runtime) — exercised by running the app, like Phase 4.
export function loadModelFromBuffer(buffer: ArrayBuffer, type: ModelFileType): LoadedModel {
  if (type === 'Stl') {
    const geometry = new STLLoader().parse(buffer)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd8cfc2 }))
    mesh.updateMatrixWorld(true)
    return { object: mesh, bounds: new THREE.Box3().setFromObject(mesh), objects: [mesh] }
  }
  const group = new ThreeMFLoader().parse(buffer)
  group.updateMatrixWorld(true)
  // Each 3MF <build><item> becomes a direct child of the loaded group.
  const objects = group.children.length > 0 ? [...group.children] : [group]
  return { object: group, bounds: new THREE.Box3().setFromObject(group), objects }
}
