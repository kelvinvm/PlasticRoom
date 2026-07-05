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

export function setActivePlate(objects: THREE.Object3D[], activeIndex: number | null): void {
  objects.forEach((object, index) => {
    object.visible = activeIndex === null || index === activeIndex
  })
}

export function setVisibleObjects(objects: THREE.Object3D[], indices: number[] | null): void {
  objects.forEach((object, index) => {
    object.visible = indices === null || indices.includes(index)
  })
}
