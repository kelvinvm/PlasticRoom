import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssignFoldersModal } from './AssignFoldersModal'
import * as client from '../api/client'
import type { Folder, ModelFile } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Printed', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 },
  { id: 2, name: 'Terrain', parentId: null, description: null, coverImageFileId: null, sortOrder: 1 },
  { id: 3, name: 'Trees', parentId: 2, description: null, coverImageFileId: null, sortOrder: 0 },
]

function setup(overrides: Partial<Parameters<typeof AssignFoldersModal>[0]> = {}) {
  const props = {
    file: { id: 7, name: 'oak.3mf', folderIds: [2] },
    folders,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    ...overrides,
  }
  render(<AssignFoldersModal {...props} />)
  return props
}

describe('AssignFoldersModal', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders a flat collection tree with a checkbox per folder', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'Printed' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Terrain' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Trees' })).toBeInTheDocument()
  })

  it('pre-checks the file’s current folders', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'Terrain' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Printed' })).not.toBeChecked()
  })

  it('saves the new set and notifies + closes when changed', async () => {
    const updated = { id: 7, folderIds: [1, 2] } as ModelFile
    const spy = vi.spyOn(client, 'setFileFolders').mockResolvedValue(updated)
    const props = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Printed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(updated))
    const [id, ids] = spy.mock.calls[0]
    expect(id).toBe(7)
    expect([...ids].sort()).toEqual([1, 2])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('closes without a network call when nothing changed', () => {
    const spy = vi.spyOn(client, 'setFileFolders')
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(spy).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows an alert and stays open when save fails', async () => {
    vi.spyOn(client, 'setFileFolders').mockRejectedValue(new Error('boom'))
    const props = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Printed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('creates a folder, auto-checks it, and notifies', async () => {
    const created: Folder = { id: 9, name: 'Dragons', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 }
    vi.spyOn(client, 'createFolder').mockResolvedValue(created)
    const props = setup()

    fireEvent.click(screen.getByRole('button', { name: '+ New collection' }))
    fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Dragons' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(props.onFolderCreated).toHaveBeenCalledWith(created))
    expect(screen.getByRole('checkbox', { name: 'Dragons' })).toBeChecked()
  })

  it('cancels on Escape', () => {
    const props = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })
})
