import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import type { Folder } from '../api/types'

const folder = (id: number, name: string, parentId: number | null, isSystem = false): Folder => ({
  id, name, parentId, description: null, coverImageFileId: null, sortOrder: 0, isSystem,
})

const folders: Folder[] = [
  folder(1, 'Miniatures', null),
  folder(2, 'DnD Campaign', 1),
  folder(3, 'Favorites', null, true),
]

describe('Sidebar', () => {
  it('renders All Files, the library tree, and collections', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} />)
    expect(screen.getByText('All Files')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
  })

  it('calls onSelectFolder with the folder id when a folder is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={onSelect} onImport={vi.fn()} />)
    fireEvent.click(screen.getByText('Miniatures'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onSelectFolder with null when All Files is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={onSelect} onImport={vi.fn()} />)
    fireEvent.click(screen.getByText('All Files'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected row with aria-current', () => {
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={vi.fn()} onImport={vi.fn()} />)
    expect(screen.getByText('Miniatures').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('renders an Import button that calls onImport', () => {
    const onImport = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={onImport} />)
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    expect(onImport).toHaveBeenCalled()
  })
})
