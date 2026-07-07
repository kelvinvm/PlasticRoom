import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../api/client', () => ({
  updateFolder: vi.fn().mockResolvedValue({}),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  reorderFolders: vi.fn().mockResolvedValue([]),
}))
import { updateFolder, deleteFolder, reorderFolders } from '../api/client'
import { Sidebar } from './Sidebar'
import type { Folder } from '../api/types'

beforeEach(() => {
  vi.clearAllMocks()
})

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
    expect(updateFolder).toHaveBeenCalledTimes(1)
  })

  it('does not open a context menu on a system (collections) folder', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Favorites'))
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
  })

  it('deletes a folder after confirmation', async () => {
    const reloadFolders = vi.fn()
    const reloadFiles = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={reloadFiles} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(reloadFolders).toHaveBeenCalled())
    expect(deleteFolder).toHaveBeenCalledWith(1)
    expect(reloadFiles).toHaveBeenCalled()
  })
})

const dndFolders: Folder[] = [
  folder(1, 'Alpha', null, false, 0),
  folder(2, 'Beta', null, false, 0),
  folder(3, 'Favorites', null, true),
]

function rowOf(name: string): HTMLElement {
  // the draggable row is the nearest ancestor with a draggable attribute
  return screen.getByText(name).closest('[draggable="true"]') as HTMLElement
}

describe('Sidebar drag-and-drop wiring', () => {
  it('dropping one library folder onto another persists a move and reloads', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    expect(reloadFolders).toHaveBeenCalled()
  })

  it('a failed reorder surfaces an alert and does not reload', async () => {
    ;(reorderFolders as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    const reloadFolders = vi.fn()
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(reloadFolders).not.toHaveBeenCalled()
  })

  it('dropping onto "All Files" un-nests to root', async () => {
    // Beta is nested under Alpha; dropping it on All Files moves it to root.
    const nested: Folder[] = [folder(1, 'Alpha', null, false, 0), folder(2, 'Beta', 1, false, 0)]
    const reloadFolders = vi.fn()
    render(<Sidebar folders={nested} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(screen.getByText('All Files').closest('div') as HTMLElement)
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
  })

  it('a system (collections) row is not draggable', () => {
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
    expect(screen.getByText('Favorites').closest('[draggable]')).toHaveAttribute('draggable', 'false')
  })
})
