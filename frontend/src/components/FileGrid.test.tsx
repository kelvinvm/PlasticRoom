import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileGrid } from './FileGrid'
import type { ModelFile, Tag } from '../api/types'

const file = (id: number, name: string, type: ModelFile['type'], tagIds: number[]): ModelFile => ({
  id, name, type, sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: `${name} description`, thumbnailPath: null, folderIds: [], tagIds, plates: [],
})

const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const sampleFile: ModelFile = {
  id: 1, name: 'widget.stl', type: 'Stl', sizeBytes: 100, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [], plates: [],
}

describe('FileGrid', () => {
  it('renders a card per file with preview label, name, description, and tag pills', () => {
    const files = [file(1, 'Dragon.stl', 'Stl', [1]), file(2, 'Set.3mf', 'ThreeMf', [])]
    render(<FileGrid files={files} tags={tags} selectedFileIds={new Set()} onSelectFile={vi.fn()} onOpenFile={vi.fn()} onRequestDelete={vi.fn()} />)
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('Dragon.stl description')).toBeInTheDocument()
    expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('3MF PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })

  it('calls onSelectFile with the click modifiers', () => {
    const onSelect = vi.fn()
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileIds={new Set()} onSelectFile={onSelect} onOpenFile={vi.fn()} onRequestDelete={vi.fn()} />)
    fireEvent.click(screen.getByText('Dragon.stl'), { ctrlKey: true })
    expect(onSelect).toHaveBeenCalledWith(1, expect.objectContaining({ ctrlKey: true, shiftKey: false }))
  })

  it('marks selected cards with aria-current', () => {
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileIds={new Set([1])} onSelectFile={vi.fn()} onOpenFile={vi.fn()} onRequestDelete={vi.fn()} />)
    expect(screen.getByText('Dragon.stl').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('calls onOpenFile on double-click and onSelectFile on single click', () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    render(
      <FileGrid files={[sampleFile]} tags={[]} selectedFileIds={new Set()} onSelectFile={onSelect} onOpenFile={onOpen} onRequestDelete={vi.fn()} />,
    )
    // Select the card specifically (the kebab button also carries the file name in its label).
    const card = screen.getByText('widget.stl').closest('button') as HTMLElement
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith(sampleFile.id, expect.objectContaining({ shiftKey: false }))
    fireEvent.doubleClick(card)
    expect(onOpen).toHaveBeenCalledWith(sampleFile.id)
  })

  it('shows a check badge on selected cards when 2+ are selected', () => {
    const files = [file(1, 'A.stl', 'Stl', []), file(2, 'B.stl', 'Stl', [])]
    render(<FileGrid files={files} tags={[]} selectedFileIds={new Set([1, 2])} onSelectFile={vi.fn()} onOpenFile={vi.fn()} onRequestDelete={vi.fn()} />)
    expect(screen.getAllByTestId('select-badge')).toHaveLength(2)
  })

  it('renders a real thumbnail image when the file has one', () => {
    const withThumb = { ...sampleFile, thumbnailPath: 'thumbs/1.png' }
    render(<FileGrid files={[withThumb]} tags={[]} selectedFileIds={new Set()} onSelectFile={() => {}} onOpenFile={() => {}} onRequestDelete={() => {}} />)
    const img = screen.getByRole('img', { name: /widget\.stl/i })
    expect(img).toHaveAttribute('src', '/api/files/1/thumbnail')
  })

  it('shows the placeholder label when the file has no thumbnail', () => {
    render(<FileGrid files={[sampleFile]} tags={[]} selectedFileIds={new Set()} onSelectFile={() => {}} onOpenFile={() => {}} onRequestDelete={() => {}} />)
    expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
  })
})

const kebabFiles = [file(1, 'Alpha.stl', 'Stl', []), file(2, 'Beta.stl', 'Stl', [])]

function renderKebabGrid() {
  const props = {
    files: kebabFiles, tags: [], selectedFileIds: new Set<number>(),
    onSelectFile: vi.fn(), onOpenFile: vi.fn(), onRequestDelete: vi.fn(),
  }
  render(<FileGrid {...props} />)
  return props
}

describe('FileGrid kebab menu', () => {
  it('renders an actions button on every tile', () => {
    renderKebabGrid()
    expect(screen.getAllByRole('button', { name: /actions for/i })).toHaveLength(2)
  })

  it('opens the menu with a Delete item on kebab click', () => {
    renderKebabGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('raises onRequestDelete with the file when Delete is clicked', () => {
    const props = renderKebabGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(props.onRequestDelete).toHaveBeenCalledWith(kebabFiles[0])
  })

  it('does not select the card when the kebab is clicked', () => {
    const props = renderKebabGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    expect(props.onSelectFile).not.toHaveBeenCalled()
  })

  it('closes the menu on Escape', () => {
    renderKebabGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('closes the menu on an outside click', () => {
    renderKebabGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.click(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('keeps only one tile menu open at a time', () => {
    renderKebabGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Beta.stl' }))
    expect(screen.getAllByRole('menuitem', { name: 'Delete' })).toHaveLength(1)
  })
})
