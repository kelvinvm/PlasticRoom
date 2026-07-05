import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BatchAssignPanel } from './BatchAssignPanel'
import * as client from '../api/client'
import type { Folder, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Terrain', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
  { id: 2, name: 'Printed', parentId: null, description: null, coverImageFileId: null, sortOrder: 1, isSystem: true },
]
const tags: Tag[] = [{ id: 5, name: 'Resin', colorKey: 'brass' }]

function setup(overrides: Partial<Parameters<typeof BatchAssignPanel>[0]> = {}) {
  const props = { selectedFileIds: [7, 8, 9], folders, tags, onApplied: vi.fn(), ...overrides }
  render(<BatchAssignPanel {...props} />)
  return props
}

describe('BatchAssignPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows the selected count and disables Apply until something is staged', () => {
    setup()
    expect(screen.getByRole('heading', { name: '3 files selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeDisabled()
  })

  it('stages a folder and enables Apply', () => {
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terrain' }))
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeEnabled()
  })

  it('filters folders by the search box', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Search folders'), { target: { value: 'terr' } })
    expect(screen.getByRole('checkbox', { name: 'Terrain' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Printed' })).not.toBeInTheDocument()
  })

  it('applies staged folders + tags, notifies, then clears + confirms', async () => {
    const spy = vi.spyOn(client, 'batchAssign').mockResolvedValue([])
    const props = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terrain' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 3' }))

    await waitFor(() => expect(props.onApplied).toHaveBeenCalled())
    const [fileIds, folderIds, tagIds] = spy.mock.calls[0]
    expect(fileIds).toEqual([7, 8, 9])
    expect(folderIds).toEqual([1])
    expect(tagIds).toEqual([5])
    expect(await screen.findByText('Added to 3 files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeDisabled()
  })

  it('shows an alert and keeps the staged set when apply fails', async () => {
    vi.spyOn(client, 'batchAssign').mockRejectedValue(new Error('boom'))
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terrain' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 3' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeEnabled()
  })
})
