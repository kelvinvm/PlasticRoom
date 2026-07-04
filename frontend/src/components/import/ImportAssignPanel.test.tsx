import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImportAssignPanel } from './ImportAssignPanel'
import type { Folder, Tag } from '../../api/types'

const folders: Folder[] = [
  { id: 3, name: 'To Print', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: true },
]
const tags: Tag[] = [{ id: 7, name: 'Resin', colorKey: 'orange' }]

const props = () => ({
  folders, tags,
  selectedFolderIds: [] as number[], onToggleFolder: vi.fn(),
  selectedTagIds: [] as number[], onToggleTag: vi.fn(),
  onCreateTag: vi.fn(),
  detectedCount: 6, readyCount: 5, failedParseCount: 1,
  importing: false, onImport: vi.fn(),
})

describe('ImportAssignPanel', () => {
  it('labels the import button with the ready count', () => {
    render(<ImportAssignPanel {...props()} />)
    expect(screen.getByRole('button', { name: /import 5 files/i })).toBeEnabled()
  })

  it('warns when some files failed to parse', () => {
    render(<ImportAssignPanel {...props()} />)
    expect(screen.getByText(/1 file.*couldn.t be parsed.*import the other 5/i)).toBeInTheDocument()
  })

  it('disables import when nothing is ready', () => {
    render(<ImportAssignPanel {...{ ...props(), readyCount: 0 }} />)
    expect(screen.getByRole('button', { name: /import 0 files/i })).toBeDisabled()
  })

  it('offers to create a tag when the query matches nothing', () => {
    const p = props()
    render(<ImportAssignPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/add a tag/i), { target: { value: 'Nylon' } })
    fireEvent.click(screen.getByText(/create .*nylon/i))
    expect(p.onCreateTag).toHaveBeenCalledWith('Nylon')
  })

  it('toggles an existing folder from the search results', () => {
    const p = props()
    render(<ImportAssignPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/search or pick a folder/i), { target: { value: 'To' } })
    fireEvent.click(screen.getByText('To Print'))
    expect(p.onToggleFolder).toHaveBeenCalledWith(3)
  })
})
