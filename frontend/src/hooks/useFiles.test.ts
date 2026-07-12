import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFiles } from './useFiles'
import * as client from '../api/client'
import type { ModelFile } from '../api/types'

const sampleFile: ModelFile = {
  id: 1, name: 'a.stl', type: 'Stl', sizeBytes: 10, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 1, dimYMm: 1, dimZMm: 1, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [], plates: [],
}

describe('useFiles', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('loads files and exposes them', async () => {
    vi.spyOn(client, 'getFiles').mockResolvedValue([sampleFile])
    const { result } = renderHook(() => useFiles(null, [], ''))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.files).toHaveLength(1)
    expect(result.current.error).toBe(false)
  })

  it('refetches when folderId changes', async () => {
    const spy = vi.spyOn(client, 'getFiles').mockResolvedValue([])
    const { rerender } = renderHook(({ id }) => useFiles(id, [], ''), {
      initialProps: { id: null as number | null },
    })
    await waitFor(() => expect(spy).toHaveBeenCalledWith(null, [], ''))
    rerender({ id: 5 })
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, [], ''))
  })

  it('refetches when tagIds change', async () => {
    const spy = vi.spyOn(client, 'getFiles').mockResolvedValue([])
    const { rerender } = renderHook(({ t }) => useFiles(null, t, ''), {
      initialProps: { t: [1] as number[] },
    })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    rerender({ t: [1, 2] })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('sets error when the request rejects', async () => {
    vi.spyOn(client, 'getFiles').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFiles(null, [], ''))
    await waitFor(() => expect(result.current.error).toBe(true))
  })

  it('refetches files when reload is called', async () => {
    const spy = vi.spyOn(client, 'getFiles').mockResolvedValue([])
    const { result } = renderHook(() => useFiles(null, [], ''))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.reload())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
