import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FileDetailPanel } from './FileDetailPanel'
import * as client from '../api/client'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 },
]
const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const file: ModelFile = {
  id: 9, name: 'Dragon.stl', type: 'Stl', sizeBytes: 5_242_880, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 42, dimYMm: 28, dimZMm: 15, plateCount: null, estPrintTimeMin: 125,
  material: 'PLA', layerHeightMm: 0.2, sourceUrl: 'https://example.com/a', creator: 'Jane',
  description: 'A dragon', thumbnailPath: null, folderIds: [1], tagIds: [1], plates: [],
}

function renderPanel(overrides: Partial<Parameters<typeof FileDetailPanel>[0]> = {}) {
  const props = {
    file,
    folders,
    tags,
    onAssignmentsSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    onFieldSaved: vi.fn(),
    onTagCreated: vi.fn(),
    ...overrides,
  }
  render(<FileDetailPanel {...props} />)
  return props
}

describe('FileDetailPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows an empty state when no file is selected', () => {
    renderPanel({ file: null })
    expect(screen.getByText('Select a file')).toBeInTheDocument()
  })

  it('renders name, formatted metadata, folder chips and tag chips', () => {
    renderPanel()
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB')).toBeInTheDocument()
    expect(screen.getByText('42 × 28 × 15 mm')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })

  it('opens the assign-folders modal from the + add pill when a file is selected', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '+ add' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('resets the thumbnail-failed state when a new file is selected', () => {
    const fileA: ModelFile = { ...file, id: 1, name: 'A.stl', thumbnailPath: '/thumbs/a.png' }
    const fileB: ModelFile = { ...file, id: 2, name: 'B.stl', thumbnailPath: '/thumbs/b.png' }

    const { rerender } = render(
      <FileDetailPanel
        file={fileA}
        folders={folders}
        tags={tags}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onFieldSaved={() => {}}
        onTagCreated={() => {}}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()

    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText(/PREVIEW/)).toBeInTheDocument()

    rerender(
      <FileDetailPanel
        file={fileB}
        folders={folders}
        tags={tags}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onFieldSaved={() => {}}
        onTagCreated={() => {}}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('saves the description on blur when changed', async () => {
    const updated = { ...file, description: 'edited' }
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(updated)
    const props = renderPanel()
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { description: 'edited' }))
    await waitFor(() => expect(props.onFieldSaved).toHaveBeenCalledWith(updated))
  })

  it('does not save on blur when a field is unchanged', () => {
    const spy = vi.spyOn(client, 'updateFile')
    renderPanel()
    fireEvent.blur(screen.getByLabelText('Description'))
    fireEvent.blur(screen.getByLabelText('Source URL'))
    fireEvent.blur(screen.getByLabelText('Creator'))
    fireEvent.blur(screen.getByLabelText('Material'))
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('saves source URL on blur when changed', async () => {
    const updated = { ...file, sourceUrl: 'https://example.com/b' }
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(updated)
    renderPanel()
    const input = screen.getByLabelText('Source URL')
    fireEvent.change(input, { target: { value: 'https://example.com/b' } })
    fireEvent.blur(input)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { sourceUrl: 'https://example.com/b' }))
  })

  it('saves creator, material, est. print time, and layer height on blur', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(file)
    renderPanel()

    fireEvent.change(screen.getByLabelText('Creator'), { target: { value: 'Bob' } })
    fireEvent.blur(screen.getByLabelText('Creator'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { creator: 'Bob' }))

    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'PETG' } })
    fireEvent.blur(screen.getByLabelText('Material'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { material: 'PETG' }))

    fireEvent.change(screen.getByLabelText('Est. print time (min)'), { target: { value: '90' } })
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { estPrintTimeMin: 90 }))

    fireEvent.change(screen.getByLabelText('Layer height (mm)'), { target: { value: '0.28' } })
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { layerHeightMm: 0.28 }))
  })

  it('ignores a blank number field instead of sending it', () => {
    const spy = vi.spyOn(client, 'updateFile')
    renderPanel()
    const input = screen.getByLabelText('Est. print time (min)')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows an error hint when a field save fails and keeps the typed value', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockRejectedValue(new Error('boom'))
    renderPanel()
    const input = screen.getByLabelText('Creator')
    fireEvent.change(input, { target: { value: 'Bob' } })
    fireEvent.blur(input)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Creator')).toHaveValue('Bob')
  })
})
