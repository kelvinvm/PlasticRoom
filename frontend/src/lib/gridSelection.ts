import type { ModelFile } from '../api/types'

export interface SelectModifiers {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

export interface Selection {
  ids: Set<number>
  anchorId: number | null
}

export const emptySelection: Selection = { ids: new Set(), anchorId: null }

export function nextSelection(
  current: Selection,
  files: ModelFile[],
  clickedId: number,
  mods: SelectModifiers,
): Selection {
  if (mods.shiftKey) {
    const anchor = current.anchorId ?? clickedId
    const order = files.map((file) => file.id)
    const a = order.indexOf(anchor)
    const b = order.indexOf(clickedId)
    if (a === -1 || b === -1) {
      return { ids: new Set([clickedId]), anchorId: clickedId }
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    return { ids: new Set(order.slice(lo, hi + 1)), anchorId: anchor }
  }
  if (mods.metaKey || mods.ctrlKey) {
    const ids = new Set(current.ids)
    if (ids.has(clickedId)) ids.delete(clickedId)
    else ids.add(clickedId)
    return { ids, anchorId: clickedId }
  }
  return { ids: new Set([clickedId]), anchorId: clickedId }
}
