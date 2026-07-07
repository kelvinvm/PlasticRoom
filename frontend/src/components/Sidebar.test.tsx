import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../api/client', () => ({
  updateFolder: vi.fn().mockResolvedValue({}),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  reorderFolders: vi.fn().mockResolvedValue([]),
}))
import { updateFolder, deleteFolder } from '../api/client'
import { Sidebar } from './Sidebar'
import type { Folder } from '../api/types'

const folder = (
  id: number, name: string, parentId: number | null, isSystem = false, fileCount = 0,
): Folder => ({
  id, name, parentId, description: null, coverImageFileId: null, sortOrder: 0, isSystem, fileCount,
})

const folders: Folder[] = [
  folder(1, 'Miniatures', null, false, 3),
  folder(2, 'DnD Campaign', 1, false, 1),
  folder(3, 'Favorites', null, true),
]

describe('Sidebar', () => {
  it('renders All Files, the library tree, and collections', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    expect(screen.getByText('All Files')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
  })

  it('calls onSelectFolder with the folder id when a folder is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={onSelect} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    fireEvent.click(screen.getByText('Miniatures'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onSelectFolder with null when All Files is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={onSelect} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    fireEvent.click(screen.getByText('All Files'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected row with aria-current', () => {
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    expect(screen.getByText('Miniatures').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('renders an Import button that calls onImport', () => {
    const onImport = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={onImport} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    expect(onImport).toHaveBeenCalled()
  })

  it('renders the file count for a folder', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    // Miniatures has 3 files.
    expect(screen.getByText('Miniatures').closest('div,button,li')).toHaveTextContent('3')
  })

  it('collapses a parent folder, hiding its children', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /collapse Miniatures/i }))
    expect(screen.queryByText('DnD Campaign')).not.toBeInTheDocument()
  })

  it('renames a library folder via the context menu', async () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const input = screen.getByDisplayValue('Miniatures')
    fireEvent.change(input, { target: { value: 'Minis' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateFolder).toHaveBeenCalledWith(1, { name: 'Minis' })
  })

  it('does not open a context menu on a system (collections) folder', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Favorites'))
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
  })

  it('deletes a folder after confirmation', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteFolder).toHaveBeenCalledWith(1)
  })
})
