import * as THREE from 'three'

export type RenderMode = 'solid' | 'wireframe' | 'plates'

const DEFAULT_COLOR = 0xd8cfc2

// Distinct, on-brand tints cycled per build-item in "plates" layout mode.
export const PLATE_COLORS: number[] = [
  0xff8a3d, // accent orange
  0x3ddc97, // success green
  0xdbb55a, // brass
  0x6db3ff, // blue
  0xe0654a, // error red
  0xb98cff, // violet
]

// Duck-typed guard: matches any material carrying a `wireframe` boolean and a
// `THREE.Color` `color` (MeshStandardMaterial, MeshPhongMaterial, MeshLambertMaterial,
// MeshPhysicalMaterial, MeshBasicMaterial). Needed because three's ThreeMFLoader builds
// MeshPhongMaterial for ordinary non-PBR 3MF materials, which does not extend
// MeshStandardMaterial.
type ColorableMaterial = THREE.Material & { wireframe: boolean; color: THREE.Color }

function isColorable(m: THREE.Material): m is ColorableMaterial {
  return 'wireframe' in m && 'color' in m && (m as { color: unknown }).color instanceof THREE.Color
}

function eachMaterial(object: THREE.Object3D, fn: (m: ColorableMaterial) => void): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of materials) {
        if (isColorable(m)) fn(m)
      }
    }
  })
}

export function applyRenderMode(objects: THREE.Object3D[], mode: RenderMode): void {
  objects.forEach((object, index) => {
    eachMaterial(object, (m) => {
      m.wireframe = mode === 'wireframe'
      m.color.setHex(mode === 'plates' ? PLATE_COLORS[index % PLATE_COLORS.length] : DEFAULT_COLOR)
    })
  })
}

export function setVisibleObjects(objects: THREE.Object3D[], indices: number[] | null): void {
  objects.forEach((object, index) => {
    object.visible = indices === null || indices.includes(index)
  })
}

// World-space bounding box enclosing the objects at the given indices.
// Out-of-range indices are ignored; an empty index set yields an empty box.
export function boundsForObjects(objects: THREE.Object3D[], indices: number[]): THREE.Box3 {
  const box = new THREE.Box3()
  for (const i of indices) {
    const object = objects[i]
    if (object) box.expandByObject(object)
  }
  return box
}

// Default isometric-ish viewing direction (matches the app's established framing).
const DEFAULT_VIEW_DIR = new THREE.Vector3(1, 0.9, 1).normalize()
// A hair of breathing room so the model doesn't touch the frame edges.
const FILL_MARGIN = 1.08

// Positions a perspective camera to frame `box` so it fills the available
// viewport, looking at the box center from `direction`, and points the orbit
// `target` at that center. Fits the more constraining of the vertical/horizontal
// FOV so nothing spills off-screen at any aspect ratio. No-op for an empty box.
export function frameCameraToBox(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  box: THREE.Box3,
  direction: THREE.Vector3 = DEFAULT_VIEW_DIR,
): void {
  if (box.isEmpty()) return

  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const center = sphere.center
  const radius = sphere.radius || 1

  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
  const fitHeight = radius / Math.sin(vFov / 2)
  const fitWidth = radius / Math.sin(hFov / 2)
  const distance = Math.max(fitHeight, fitWidth) * FILL_MARGIN

  const dir = direction.clone().normalize()
  camera.position.copy(center).addScaledVector(dir, distance)
  camera.near = Math.max(0.01, radius * 0.01)
  camera.far = distance + radius * 10
  camera.updateProjectionMatrix()
  camera.lookAt(center)

  target.copy(center)
}
