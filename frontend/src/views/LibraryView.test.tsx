// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryView } from './LibraryView'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
]
const tags: Tag[] = []
const dragon: ModelFile = {
  id: 10, name: 'Dragon.stl', type: 'Stl', sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [1], tagIds: [], plates: [],
}
const goblin: ModelFile = { ...dragon, id: 11, name: 'Goblin.stl' }

let deleted = false
function mockApi(opts: { deleteOk?: boolean } = {}) {
  deleted = false
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      deleted = true
      return Promise.resolve({ ok: opts.deleteOk ?? true } as Response)
    }
    let body: unknown = []
    if (url.startsWith('/api/folders')) body = folders
    else if (url.startsWith('/api/tags')) body = tags
    else if (url.startsWith('/api/files')) body = deleted ? [goblin] : [dragon, goblin]
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
  }))
}

function renderView() {
  render(<LibraryView onImport={vi.fn()} onOpenFile={vi.fn()} />)
}

async function openDeleteFor(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
}

describe('LibraryView file delete', () => {
  beforeEach(() => mockApi())
  afterEach(() => vi.unstubAllGlobals())

  it('deletes a file after confirmation and refetches', async () => {
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/files/10', expect.objectContaining({ method: 'DELETE' })),
    )
    await waitFor(() => expect(screen.queryByText('Dragon.stl')).not.toBeInTheDocument())
  })

  it('does not delete when cancelled', async () => {
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetch).not.toHaveBeenCalledWith('/api/files/10', expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
  })

  it('drops the deleted file from a multi-selection', async () => {
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Dragon.stl'))
    fireEvent.click(screen.getByText('Goblin.stl'), { ctrlKey: true })
    expect(screen.getByRole('heading', { name: '2 files selected' })).toBeInTheDocument()
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '2 files selected' })).not.toBeInTheDocument(),
    )
  })

  it('keeps the dialog open and shows an error when delete fails', async () => {
    mockApi({ deleteOk: false })
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete file.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
