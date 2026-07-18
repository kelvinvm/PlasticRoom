import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DetailInfoPanel } from './DetailInfoPanel'
import * as client from '../../api/client'
import type { ModelFile, Tag } from '../../api/types'

const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const file: ModelFile = {
  id: 5, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 2048, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 2, estPrintTimeMin: 90, material: 'PLA',
  layerHeightMm: 0.2, sourceUrl: 'https://example.com/a', creator: 'Jane', description: 'orig', thumbnailPath: 't',
  folderIds: [], tagIds: [], plates: [],
}

function renderPanel(overrides: Partial<Parameters<typeof DetailInfoPanel>[0]> = {}) {
  const props = {
    file,
    folders: [],
    tags,
    onFieldSaved: vi.fn(),
    onAssignmentsSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    onTagCreated: vi.fn(),
    ...overrides,
  }
  render(<DetailInfoPanel {...props} />)
  return props
}

describe('DetailInfoPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders spec rows including plate count', () => {
    renderPanel()
    expect(screen.getByText('Dimensions')).toBeInTheDocument()
    expect(screen.getByText('10 × 20 × 30 mm')).toBeInTheDocument()
    expect(screen.getByText('Plates')).toBeInTheDocument()
  })

  it('saves the description on blur when changed', async () => {
    const updated = { ...file, description: 'edited' }
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(updated)
    const props = renderPanel()
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { description: 'edited' }))
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

  it('saves source URL, creator, material, print time, and layer height on blur', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(file)
    renderPanel()

    fireEvent.change(screen.getByLabelText('Source URL'), { target: { value: 'https://example.com/b' } })
    fireEvent.blur(screen.getByLabelText('Source URL'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { sourceUrl: 'https://example.com/b' }))

    fireEvent.change(screen.getByLabelText('Creator'), { target: { value: 'Bob' } })
    fireEvent.blur(screen.getByLabelText('Creator'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { creator: 'Bob' }))

    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'PETG' } })
    fireEvent.blur(screen.getByLabelText('Material'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { material: 'PETG' }))

    fireEvent.change(screen.getByLabelText('Est. print time (min)'), { target: { value: '77' } })
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { estPrintTimeMin: 77 }))

    fireEvent.change(screen.getByLabelText('Layer height (mm)'), { target: { value: '0.16' } })
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { layerHeightMm: 0.16 }))
  })

  it('opens the assign-folders modal from the + add pill', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '+ add' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows an error hint when saving the description fails', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockRejectedValue(new Error('boom'))
    const props = renderPanel()
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { description: 'edited' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't save/i))
    expect(props.onFieldSaved).not.toHaveBeenCalled()
  })

  it('clears a stale save error when navigating to a different file', async () => {
    vi.spyOn(client, 'updateFile').mockRejectedValue(new Error('boom'))
    const { rerender } = render(
      <DetailInfoPanel
        file={file}
        folders={[]}
        tags={tags}
        onFieldSaved={() => {}}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onTagCreated={() => {}}
      />,
    )
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    const other = { ...file, id: file.id + 1, description: 'other' }
    rerender(
      <DetailInfoPanel
        file={other}
        folders={[]}
        tags={tags}
        onFieldSaved={() => {}}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onTagCreated={() => {}}
      />,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
