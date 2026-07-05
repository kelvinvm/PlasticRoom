import { describe, expect, it } from 'vitest'
import { nextSelection, emptySelection } from './gridSelection'
import type { ModelFile } from '../api/types'

const f = (id: number): ModelFile => ({
  id, name: `f${id}`, type: 'Stl', sizeBytes: 0, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [], plates: [],
})
const files = [f(1), f(2), f(3), f(4), f(5)]
const noMods = { metaKey: false, ctrlKey: false, shiftKey: false }

describe('gridSelection', () => {
  it('plain click selects only the clicked file', () => {
    const s = nextSelection({ ids: new Set([2, 3]), anchorId: 3 }, files, 5, noMods)
    expect([...s.ids]).toEqual([5])
    expect(s.anchorId).toBe(5)
  })

  it('ctrl/meta click toggles the clicked file', () => {
    const added = nextSelection({ ids: new Set([1]), anchorId: 1 }, files, 3, { ...noMods, ctrlKey: true })
    expect([...added.ids].sort()).toEqual([1, 3])
    const removed = nextSelection(added, files, 1, { ...noMods, metaKey: true })
    expect([...removed.ids]).toEqual([3])
  })

  it('shift click selects an inclusive range from the anchor', () => {
    const s = nextSelection({ ids: new Set([2]), anchorId: 2 }, files, 4, { ...noMods, shiftKey: true })
    expect([...s.ids].sort()).toEqual([2, 3, 4])
    expect(s.anchorId).toBe(2)
  })

  it('shift click with no anchor behaves like a plain click', () => {
    const s = nextSelection(emptySelection, files, 4, { ...noMods, shiftKey: true })
    expect([...s.ids]).toEqual([4])
    expect(s.anchorId).toBe(4)
  })
})
