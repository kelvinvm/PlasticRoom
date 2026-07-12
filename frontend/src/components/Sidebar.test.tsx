import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  id: number, name: string, parentId: number | null, fileCount = 0,
): Folder => ({
  id, name, parentId, description: null, coverImageFileId: null, sortOrder: 0, fileCount,
})

const folders: Folder[] = [
  folder(1, 'Miniatures', null, 3),
  folder(2, 'DnD Campaign', 1, 1),
  folder(3, 'Favorites', null),
]

describe('Sidebar', () => {
  it('renders All Files, the library tree, and collections', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    expect(screen.getByText('All Files')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
  })

  it('renders a Tags section and toggles a tag on click', () => {
    const onToggleTag = vi.fn()
    const tags = [
      { id: 10, name: 'PLA', colorKey: 'green' },
      { id: 11, name: 'Printed', colorKey: 'orange' },
    ]
    render(
      <Sidebar
        folders={[]}
        selectedFolderId={null}
        onSelectFolder={vi.fn()}
        onImport={vi.fn()}
        reloadFolders={vi.fn()}
        reloadFiles={vi.fn()}
        tags={tags}
        selectedTagIds={[11]}
        onToggleTag={onToggleTag}
      />,
    )
    expect(screen.getByText('Tags')).toBeInTheDocument()
    const printed = screen.getByRole('button', { name: 'Printed' })
    expect(printed).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'PLA' }))
    expect(onToggleTag).toHaveBeenCalledWith(10)
  })

  it('calls onSelectFolder with the folder id when a folder is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={onSelect} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.click(screen.getByText('Miniatures'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onSelectFolder with null when All Files is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={onSelect} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.click(screen.getByText('All Files'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected row with aria-current', () => {
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    expect(screen.getByText('Miniatures').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('renders an Import button that calls onImport', () => {
    const onImport = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={onImport} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    expect(onImport).toHaveBeenCalled()
  })

  it('renders the file count for a folder', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    // Miniatures has 3 files.
    expect(screen.getByText('Miniatures').closest('div,button,li')).toHaveTextContent('3')
  })

  it('collapses a parent folder, hiding its children', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /collapse Miniatures/i }))
    expect(screen.queryByText('DnD Campaign')).not.toBeInTheDocument()
  })

  it('renames a library folder via the context menu', async () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const input = screen.getByDisplayValue('Miniatures')
    fireEvent.change(input, { target: { value: 'Minis' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateFolder).toHaveBeenCalledWith(1, { name: 'Minis' })
    expect(updateFolder).toHaveBeenCalledTimes(1)
  })

  it('closes the context menu on Escape', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
  })

  it('closes the context menu on an outside click', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    fireEvent.click(document.body)
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
  })

  it('keeps only one context menu open at a time', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.contextMenu(screen.getByText('DnD Campaign'))
    // Both rows can rename; only the most recently opened menu should be present.
    expect(screen.getAllByRole('menuitem', { name: /rename/i })).toHaveLength(1)
  })

  it('deletes a folder after confirmation', async () => {
    const reloadFolders = vi.fn()
    const reloadFiles = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={reloadFiles} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(reloadFolders).toHaveBeenCalled())
    expect(deleteFolder).toHaveBeenCalledWith(1)
    expect(reloadFiles).toHaveBeenCalled()
  })
})

const dndFolders: Folder[] = [
  folder(1, 'Alpha', null, 0),
  folder(2, 'Beta', null, 0),
  folder(3, 'Favorites', null),
]

function rowOf(name: string): HTMLElement {
  // the draggable row is the nearest ancestor with a draggable attribute
  return screen.getByText(name).closest('[draggable="true"]') as HTMLElement
}

// jsdom has no DragEvent (testing-library falls back to a plain Event that drops
// clientY) and getBoundingClientRect returns a zero rect, so zoneFromEvent would
// always resolve to 'onto'. Mock the row's rect and set clientY on the event by hand
// to exercise the before/after zone thresholds (top 25% / bottom 25% of a 40px row).
function fireZonedDrop(target: HTMLElement, zone: 'before' | 'after') {
  const rect = { top: 100, bottom: 140, height: 40, width: 0, left: 0, right: 0, x: 0, y: 100, toJSON() {} }
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
  const clientY = zone === 'before' ? 105 : 135 // offset 5 (<10) → before; 35 (>30) → after
  for (const type of ['dragOver', 'drop'] as const) {
    const event = createEvent[type](target)
    Object.defineProperty(event, 'clientY', { value: clientY })
    fireEvent(target, event)
  }
}

const threeRoots: Folder[] = [
  folder(1, 'Alpha', null, 0),
  folder(2, 'Beta', null, 0),
  folder(3, 'Gamma', null, 0),
]

describe('Sidebar drag-and-drop wiring', () => {
  it('dropping one library folder onto another persists a move and reloads', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    expect(reloadFolders).toHaveBeenCalled()
  })

  it('a failed reorder surfaces an alert and does not reload', async () => {
    ;(reorderFolders as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    const reloadFolders = vi.fn()
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(reloadFolders).not.toHaveBeenCalled()
  })

  it('a successful move also reloads files (grid filter is descendant-inclusive)', async () => {
    const reloadFiles = vi.fn()
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={reloadFiles} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    await waitFor(() => expect(reloadFiles).toHaveBeenCalled())
  })

  it('starting a new drag clears a lingering move error', async () => {
    ;(reorderFolders as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    render(<Sidebar folders={dndFolders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.dragStart(rowOf('Beta'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('dropping onto "All Files" un-nests to root', async () => {
    // Beta is nested under Alpha; dropping it on All Files moves it to root.
    const nested: Folder[] = [folder(1, 'Alpha', null, 0), folder(2, 'Beta', 1, 0)]
    const reloadFolders = vi.fn()
    render(<Sidebar folders={nested} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(screen.getByText('All Files').closest('div') as HTMLElement)
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
  })

  it('dropping in the top zone re-orders the folder before the target', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar folders={threeRoots} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Gamma'))
    fireZonedDrop(rowOf('Alpha'), 'before')
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    // 'before' keeps Gamma at root (parentId null) and slots it ahead of Alpha (sortOrder 0),
    // distinguishing it from an 'onto' drop, which would re-parent Gamma under Alpha.
    expect(reorderFolders).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 3, parentId: null, sortOrder: 0 })]),
    )
    expect(reloadFolders).toHaveBeenCalled()
  })

  it('dropping in the bottom zone re-orders the folder after the target', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar folders={threeRoots} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} tags={[]} selectedTagIds={[]} onToggleTag={vi.fn()} />)
    fireEvent.dragStart(rowOf('Gamma'))
    fireZonedDrop(rowOf('Alpha'), 'after')
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    // 'after' keeps Gamma at root and slots it just behind Alpha (index 1).
    expect(reorderFolders).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 3, parentId: null, sortOrder: 1 })]),
    )
    expect(reloadFolders).toHaveBeenCalled()
  })
})
