// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DetailView } from './DetailView'
import * as client from '../api/client'
import * as foldersHook from '../hooks/useFolders'
import * as tagsHook from '../hooks/useTags'
import type { ModelFile } from '../api/types'

vi.mock('../components/viewer/ModelViewer', () => ({
  ModelViewer: () => <div data-testid="model-viewer" />,
}))

const file: ModelFile = {
  id: 5, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 2048, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 1, estPrintTimeMin: null, material: null,
  layerHeightMm: null, sourceUrl: null, creator: null, description: '', thumbnailPath: null,
  folderIds: [], tagIds: [],
}

describe('DetailView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(foldersHook, 'useFolders').mockReturnValue({ folders: [], loading: false, error: false } as never)
    vi.spyOn(tagsHook, 'useTags').mockReturnValue({ tags: [], loading: false, error: false } as never)
    vi.spyOn(client, 'getFile').mockResolvedValue(file)
    // Content fetch rejects → viewer shows the error state, but metadata still renders.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
  })

  it('renders the breadcrumb with the origin folder and file name', async () => {
    render(<DetailView fileId={5} fromFolder={{ id: 1, name: 'Miniatures' }} onBack={() => {}} />)
    await waitFor(() =>
      expect(within(screen.getByTestId('breadcrumb')).getByText('dragon.3mf')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Miniatures' })).toBeInTheDocument()
  })

  it('calls onBack when the leading breadcrumb is clicked', async () => {
    const onBack = vi.fn()
    render(<DetailView fileId={5} fromFolder={null} onBack={onBack} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows an error state in the viewer area when content fails to load', async () => {
    render(<DetailView fileId={5} fromFolder={null} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText(/couldn't load this model/i)).toBeInTheDocument())
    expect(screen.getByText('SPECS')).toBeInTheDocument()
  })
})
