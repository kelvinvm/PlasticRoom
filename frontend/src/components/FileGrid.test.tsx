import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileGrid } from './FileGrid'
import type { ModelFile, Tag } from '../api/types'

const file = (id: number, name: string, type: ModelFile['type'], tagIds: number[]): ModelFile => ({
  id, name, type, sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: `${name} description`, thumbnailPath: null, folderIds: [], tagIds,
})

const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const sampleFile: ModelFile = {
  id: 1, name: 'widget.stl', type: 'Stl', sizeBytes: 100, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [],
}

describe('FileGrid', () => {
  it('renders a card per file with preview label, name, description, and tag pills', () => {
    const files = [file(1, 'Dragon.stl', 'Stl', [1]), file(2, 'Set.3mf', 'ThreeMf', [])]
    render(<FileGrid files={files} tags={tags} selectedFileId={null} onSelectFile={vi.fn()} onOpenFile={vi.fn()} />)
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('Dragon.stl description')).toBeInTheDocument()
    expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('3MF PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })

  it('calls onSelectFile when a card is clicked', () => {
    const onSelect = vi.fn()
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileId={null} onSelectFile={onSelect} onOpenFile={vi.fn()} />)
    fireEvent.click(screen.getByText('Dragon.stl'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('marks the selected card with aria-current', () => {
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileId={1} onSelectFile={vi.fn()} onOpenFile={vi.fn()} />)
    expect(screen.getByText('Dragon.stl').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('calls onOpenFile on double-click and onSelectFile on single click', () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    render(
      <FileGrid
        files={[sampleFile]}
        tags={[]}
        selectedFileId={null}
        onSelectFile={onSelect}
        onOpenFile={onOpen}
      />,
    )
    const card = screen.getByRole('button', { name: /widget\.stl/i })
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith(sampleFile.id)
    fireEvent.doubleClick(card)
    expect(onOpen).toHaveBeenCalledWith(sampleFile.id)
  })
})
