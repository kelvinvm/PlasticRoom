import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileDetailPanel } from './FileDetailPanel'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
]
const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const file: ModelFile = {
  id: 9, name: 'Dragon.stl', type: 'Stl', sizeBytes: 5_242_880, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 42, dimYMm: 28, dimZMm: 15, plateCount: null, estPrintTimeMin: 125,
  material: 'PLA', layerHeightMm: 0.2, sourceUrl: null, creator: 'Jane',
  description: 'A dragon', thumbnailPath: null, folderIds: [1], tagIds: [1],
}

describe('FileDetailPanel', () => {
  it('shows an empty state when no file is selected', () => {
    render(<FileDetailPanel file={null} folders={folders} tags={tags} />)
    expect(screen.getByText('Select a file')).toBeInTheDocument()
  })

  it('renders name, formatted metadata, folder chips and tag chips', () => {
    render(<FileDetailPanel file={file} folders={folders} tags={tags} />)
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB')).toBeInTheDocument()
    expect(screen.getByText('42 × 28 × 15 mm')).toBeInTheDocument()
    expect(screen.getByText('2h 5m')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })
})
