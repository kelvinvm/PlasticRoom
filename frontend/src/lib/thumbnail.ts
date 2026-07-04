import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'

export type ModelDims = { x: number; y: number; z: number }

export interface ThumbnailResult {
  pngBlob: Blob
  dims: ModelDims
  plateCount: number | null
}

export type ThumbnailGenerator = (file: File) => Promise<ThumbnailResult>

export function fileTypeFromName(name: string): 'ThreeMf' | 'Stl' | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.stl')) return 'Stl'
  if (lower.endsWith('.3mf')) return 'ThreeMf'
  return null
}

// World-space bounding-box size of a rendered object, honoring the transforms
// the loader bakes into each mesh (3MF build items are positioned across the
// plate). Local-space bounds would ignore those transforms and misframe.
export function dimsFromObject(object: THREE.Object3D): ModelDims {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return { x: 0, y: 0, z: 0 }
  const size = new THREE.Vector3()
  box.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

// Loads the file into a THREE.Object3D and a plate count for 3MF (build items).
// Pure JS — no WebGL — but not asserted in tests because it needs the loaders'
// runtime; exercised by running the app.
async function loadModel(
  file: File,
): Promise<{ object: THREE.Object3D; plateCount: number | null }> {
  const buffer = await file.arrayBuffer()
  const type = fileTypeFromName(file.name)
  if (type === 'Stl') {
    const geometry = new STLLoader().parse(buffer)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd8cfc2 }))
    return { object: mesh, plateCount: null }
  }
  if (type === 'ThreeMf') {
    const group = new ThreeMFLoader().parse(buffer)
    let plateCount = 0
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) plateCount += 1
    })
    return { object: group, plateCount: plateCount || 1 }
  }
  throw new Error('Unsupported file type')
}

function renderToPng(object: THREE.Object3D): Promise<Blob> {
  const size = 320
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(size, size, false)

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(1, 1, 1)
  scene.add(key)
  scene.add(object)

  // Frame the camera on the object's WORLD-space bounds so transformed 3MF
  // build items (offset across the plate) stay in view.
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const center = new THREE.Vector3()
  const extent = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(extent)
  const radius = Math.max(extent.x, extent.y, extent.z) || 1

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, radius * 100)
  camera.position.set(center.x + radius * 1.6, center.y + radius * 1.4, center.z + radius * 1.6)
  camera.lookAt(center)

  renderer.render(scene, camera)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      renderer.dispose()
      if (blob) resolve(blob)
      else reject(new Error('Failed to render thumbnail'))
    }, 'image/png')
  })
}

export const generateThumbnail: ThumbnailGenerator = async (file) => {
  const { object, plateCount } = await loadModel(file)
  const dims = dimsFromObject(object)
  const pngBlob = await renderToPng(object)
  return { pngBlob, dims, plateCount }
}
