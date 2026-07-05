import * as THREE from 'three'
import {
  type LoadedModel,
  type ModelDims,
  type ModelFileType,
  dimsFromObject,
  fileTypeFromName,
  loadModelFromBuffer,
} from './modelLoading'

export type { ModelDims } from './modelLoading'
export { fileTypeFromName, dimsFromObject } from './modelLoading'

export interface ThumbnailResult {
  pngBlob: Blob
  dims: ModelDims
  plateCount: number | null
}

export type ThumbnailGenerator = (file: File) => Promise<ThumbnailResult>

async function loadFromFile(
  file: File,
): Promise<{ object: THREE.Object3D; plateCount: number | null }> {
  const buffer = await file.arrayBuffer()
  const type: ModelFileType | null = fileTypeFromName(file.name)
  if (type === null) throw new Error('Unsupported file type')
  const { object, objects } = loadModelFromBuffer(buffer, type)
  const plateCount = type === 'ThreeMf' ? objects.length || 1 : null
  return { object, plateCount }
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
  const { object, plateCount } = await loadFromFile(file)
  const dims = dimsFromObject(object)
  const pngBlob = await renderToPng(object)
  return { pngBlob, dims, plateCount }
}

// Renders each top-level build item ("plate") to its own PNG data URL by
// isolating it in a shared offscreen scene. Reparents `model.object` into a
// temp scene and removes it again (restoring each object's visibility), so this
// MUST run BEFORE handing the model to the live viewer. Returns [] for
// single-object models (the filmstrip is hidden in that case anyway); an entry
// is '' for any build item with empty bounds.
export function renderPlateThumbnails(model: LoadedModel, size = 128): string[] {
  const { object, objects } = model
  if (objects.length <= 1) return []

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

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
  const prevVisible = objects.map((o) => o.visible)
  const center = new THREE.Vector3()
  const extent = new THREE.Vector3()
  const urls: string[] = []

  try {
    for (let i = 0; i < objects.length; i++) {
      objects.forEach((o, j) => (o.visible = j === i))
      object.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(objects[i])
      if (box.isEmpty()) {
        urls.push('')
        continue
      }
      box.getCenter(center)
      box.getSize(extent)
      const radius = Math.max(extent.x, extent.y, extent.z) || 1
      camera.near = radius / 100
      camera.far = radius * 100
      camera.position.set(center.x + radius * 1.6, center.y + radius * 1.4, center.z + radius * 1.6)
      camera.lookAt(center)
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
      urls.push(canvas.toDataURL('image/png'))
    }
  } finally {
    objects.forEach((o, j) => (o.visible = prevVisible[j]))
    scene.remove(object)
    renderer.dispose()
  }

  return urls
}
