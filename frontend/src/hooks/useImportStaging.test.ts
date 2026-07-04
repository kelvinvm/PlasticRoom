// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImportStaging, type ImportStagingApi } from './useImportStaging'
import type { ThumbnailGenerator } from '../lib/thumbnail'

const stlFile = (name = 'a.stl') => new File([new Uint8Array([1, 2, 3])], name)

const okGenerate: ThumbnailGenerator = async () => ({
  pngBlob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  dims: { x: 10, y: 20, z: 30 },
  plateCount: null,
})

const stubApi = (): ImportStagingApi => ({
  uploadFile: vi.fn(async ({ file }) => ({ id: file.name.length })) as unknown as ImportStagingApi['uploadFile'],
  uploadThumbnail: vi.fn(async () => ({ id: 1 })) as unknown as ImportStagingApi['uploadThumbnail'],
  createTag: vi.fn(async (name: string, colorKey: string | null) => ({ id: 99, name, colorKey })) as ImportStagingApi['createTag'],
})

describe('useImportStaging — add/parse', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('marks a valid file ready with dims and counts it', async () => {
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api: stubApi() }))
    act(() => result.current.addFiles([stlFile('dragon.stl')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('ready'))
    expect(result.current.items[0].dims).toEqual({ x: 10, y: 20, z: 30 })
    expect(result.current.readyCount).toBe(1)
    expect(result.current.detectedCount).toBe(1)
    expect(result.current.failedParseCount).toBe(0)
  })

  it('marks an unsupported file as parse-error without calling generate', async () => {
    const generate = vi.fn(okGenerate)
    const { result } = renderHook(() => useImportStaging({ generate, api: stubApi() }))
    act(() => result.current.addFiles([new File([new Uint8Array([1])], 'notes.txt')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('parse-error'))
    expect(generate).not.toHaveBeenCalled()
    expect(result.current.failedParseCount).toBe(1)
    expect(result.current.readyCount).toBe(0)
  })

  it('marks parse-error when generate throws', async () => {
    const generate: ThumbnailGenerator = async () => { throw new Error('corrupt') }
    const { result } = renderHook(() => useImportStaging({ generate, api: stubApi() }))
    act(() => result.current.addFiles([stlFile()]))
    await waitFor(() => expect(result.current.items[0].status).toBe('parse-error'))
    expect(result.current.items[0].error).toMatch(/parse|corrupt|geometry/i)
  })

  it('toggles folder and tag selection', () => {
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api: stubApi() }))
    act(() => result.current.toggleFolder(3))
    act(() => result.current.toggleTag(7))
    expect(result.current.selectedFolderIds).toEqual([3])
    expect(result.current.selectedTagIds).toEqual([7])
    act(() => result.current.toggleFolder(3))
    expect(result.current.selectedFolderIds).toEqual([])
  })

  it('creates a tag and selects it', async () => {
    const api = stubApi()
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api }))
    await act(async () => { await result.current.createAndSelectTag('Resin') })
    expect(api.createTag).toHaveBeenCalledWith('Resin', expect.any(String))
    expect(result.current.createdTags.map((t) => t.name)).toContain('Resin')
    expect(result.current.selectedTagIds).toContain(99)
  })
})
