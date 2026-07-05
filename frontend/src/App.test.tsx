// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Folder, ModelFile, Tag } from './api/types'

vi.mock('./views/DetailView', () => ({
  DetailView: (props: { onBack: () => void }) => (
    <div data-testid="detail-view">
      <button onClick={props.onBack}>close-detail</button>
    </div>
  ),
}))

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
  { id: 2, name: 'Favorites', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: true },
]
const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]
const dragon: ModelFile = {
  id: 10, name: 'Dragon.stl', type: 'Stl', sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: 'A dragon', thumbnailPath: null, folderIds: [1], tagIds: [1],
}

function mockApi(filesForCall: () => ModelFile[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      let body: unknown = []
      if (url.startsWith('/api/folders')) body = folders
      else if (url.startsWith('/api/tags')) body = tags
      else if (url.startsWith('/api/files')) body = filesForCall()
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }),
  )
}

describe('App', () => {
  beforeEach(() => {
    mockApi(() => [dragon])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the sidebar, the grid, and updates the detail panel on card click', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Dragon.stl'))
    // Detail panel now shows the file's formatted size (unique to the panel).
    await waitFor(() => expect(screen.getByText('1.0 KB')).toBeInTheDocument())
  })

  it('refetches with folderId when a folder is selected', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Miniatures'))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/files?folderId=1')),
    )
  })

  it('shows an empty state when a folder has no files', async () => {
    mockApi(() => [])
    render(<App />)
    await waitFor(() => expect(screen.getByText(/no files/i)).toBeInTheDocument())
  })

  it('switches to the import view when Import is clicked, and back on cancel', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /import files/i }))
    await waitFor(() => expect(screen.getByText(/drop 3mf/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
  })

  it('opens the detail layer when a file is opened and closes on back', async () => {
    render(<App />)
    const card = await screen.findByRole('button', { name: /\.stl|\.3mf/i })
    fireEvent.doubleClick(card)
    expect(screen.getByTestId('detail-view')).toBeInTheDocument()
    fireEvent.click(screen.getByText('close-detail'))
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument()
  })
})
