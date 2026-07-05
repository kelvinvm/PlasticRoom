import { describe, expect, it } from 'vitest'
import { buildViewerPlates } from './viewerPlates'
import type { ModelFile } from '../api/types'

function file(partial: Partial<ModelFile>): ModelFile {
  return {
    id: 7, name: 'x.3mf', type: 'ThreeMf', sizeBytes: 1, addedAt: '2026-07-04T00:00:00Z',
    dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
    material: null, layerHeightMm: null, sourceUrl: null, creator: null, description: null,
    thumbnailPath: null, folderIds: [], tagIds: [], plates: [], ...partial,
  }
}

describe('buildViewerPlates', () => {
  it('maps Bambu plates to server thumbnails + grouped indices', () => {
    const f = file({
      plates: [
        { index: 1, name: 'Corners', buildItemIndices: [0, 2] },
        { index: 2, name: '', buildItemIndices: [1] },
      ],
    })
    const plates = buildViewerPlates(f, 3, [])
    expect(plates).toEqual([
      { label: 'Corners', thumbnailUrl: '/api/files/7/plates/1/thumbnail', objectIndices: [0, 2] },
      { label: 'Plate 2', thumbnailUrl: '/api/files/7/plates/2/thumbnail', objectIndices: [1] },
    ])
  })

  it('falls back to one plate per build item with client thumbnails', () => {
    const plates = buildViewerPlates(file({}), 2, ['data:a', 'data:b'])
    expect(plates).toEqual([
      { label: 'Plate 1', thumbnailUrl: 'data:a', objectIndices: [0] },
      { label: 'Plate 2', thumbnailUrl: 'data:b', objectIndices: [1] },
    ])
  })

  it('returns [] for a single-object non-Bambu model', () => {
    expect(buildViewerPlates(file({}), 1, [])).toEqual([])
  })
})
