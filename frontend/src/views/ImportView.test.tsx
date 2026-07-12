// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportView } from './ImportView'
import type { UseImportStagingDeps } from '../hooks/useImportStaging'
import type { ThumbnailGenerator } from '../lib/thumbnail'

const folders = [{ id: 3, name: 'To Print', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 }]
const tags = [{ id: 7, name: 'Resin', colorKey: 'orange' }]

const generate: ThumbnailGenerator = async () => ({
  pngBlob: new Blob([new Uint8Array([0])], { type: 'image/png' }), dims: { x: 1, y: 2, z: 3 }, plateCount: null,
})
const deps = (): UseImportStagingDeps => ({
  generate,
  api: {
    uploadFile: vi.fn(async () => ({ id: 1 })) as unknown as UseImportStagingDeps['api']['uploadFile'],
    uploadThumbnail: vi.fn(async () => ({ id: 1 })) as unknown as UseImportStagingDeps['api']['uploadThumbnail'],
    createTag: vi.fn(async (n: string, c: string | null) => ({ id: 9, name: n, colorKey: c })) as UseImportStagingDeps['api']['createTag'],
  },
})

describe('ImportView', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const body = String(url).includes('/api/folders') ? folders : String(url).includes('/api/tags') ? tags : []
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('adds a dropped file, shows a ready row, imports, and calls onImported', async () => {
    const onImported = vi.fn()
    render(<ImportView onBack={vi.fn()} onImported={onImported} deps={deps()} />)
    const file = new File([new Uint8Array([1])], 'a.stl')
    const zone = screen.getByText(/drop 3mf/i).closest('div')!
    act(() => { fireEvent.drop(zone, { dataTransfer: { files: [file] } }) })
    await waitFor(() => expect(screen.getByText('a.stl')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /import 1 files/i })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /import 1 files/i })) })
    await waitFor(() => expect(onImported).toHaveBeenCalled())
  })

  it('calls onBack from the cancel control', () => {
    const onBack = vi.fn()
    render(<ImportView onBack={onBack} onImported={vi.fn()} deps={deps()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
