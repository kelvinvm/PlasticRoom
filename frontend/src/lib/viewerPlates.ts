import type { ModelFile } from '../api/types'
import { plateThumbnailUrl } from '../api/client'

export interface ViewerPlate {
  label: string
  thumbnailUrl: string | null
  objectIndices: number[]
}

// Converges the two plate sources into one model the viewer/filmstrip consume:
// Bambu files use the server-stored plate manifest + embedded thumbnails; other
// multi-object 3MF fall back to one plate per build item with client-rendered
// thumbnails. Single-object / STL yield [] (filmstrip hidden).
export function buildViewerPlates(
  file: ModelFile,
  objectCount: number,
  fallbackThumbs: string[],
): ViewerPlate[] {
  if (file.plates.length > 0) {
    return file.plates.map((p) => ({
      label: p.name || `Plate ${p.index}`,
      thumbnailUrl: plateThumbnailUrl(file.id, p.index),
      objectIndices: p.buildItemIndices,
    }))
  }

  if (objectCount <= 1) return []

  return Array.from({ length: objectCount }, (_, i) => ({
    label: `Plate ${i + 1}`,
    thumbnailUrl: fallbackThumbs[i] ?? null,
    objectIndices: [i],
  }))
}
