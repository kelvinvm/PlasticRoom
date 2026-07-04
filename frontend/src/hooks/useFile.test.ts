import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFile } from './useFile'
import * as client from '../api/client'
import type { ModelFile } from '../api/types'

const sample: ModelFile = {
  id: 7, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 1000, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 2, estPrintTimeMin: null, material: null,
  layerHeightMm: null, sourceUrl: null, creator: null, description: 'hi', thumbnailPath: 't',
  folderIds: [], tagIds: [],
}

describe('useFile', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns null and does not fetch for a null id', () => {
    const spy = vi.spyOn(client, 'getFile')
    const { result } = renderHook(() => useFile(null))
    expect(result.current.file).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('fetches and returns the file for a numeric id', async () => {
    vi.spyOn(client, 'getFile').mockResolvedValue(sample)
    const { result } = renderHook(() => useFile(7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.file).toEqual(sample)
    expect(result.current.error).toBe(false)
  })

  it('sets error when the fetch rejects', async () => {
    vi.spyOn(client, 'getFile').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFile(7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(true)
    expect(result.current.file).toBeNull()
  })
})
