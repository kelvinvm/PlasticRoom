import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DetailInfoPanel } from './DetailInfoPanel'
import * as client from '../../api/client'
import type { ModelFile } from '../../api/types'

const file: ModelFile = {
  id: 5, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 2048, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 2, estPrintTimeMin: 90, material: 'PLA',
  layerHeightMm: 0.2, sourceUrl: null, creator: null, description: 'orig', thumbnailPath: 't',
  folderIds: [], tagIds: [],
}

describe('DetailInfoPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders spec rows including plate count', () => {
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={() => {}} />)
    expect(screen.getByText('Dimensions')).toBeInTheDocument()
    expect(screen.getByText('10 × 20 × 30 mm')).toBeInTheDocument()
    expect(screen.getByText('Plates')).toBeInTheDocument()
  })

  it('saves the description on blur when changed', async () => {
    const updated = { ...file, description: 'edited' }
    const spy = vi.spyOn(client, 'updateFileDescription').mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={onSaved} />)
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, 'edited'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it('does not save on blur when the description is unchanged', () => {
    const spy = vi.spyOn(client, 'updateFileDescription')
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={() => {}} />)
    fireEvent.blur(screen.getByLabelText('Description'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows a disabled add-to-folder placeholder', () => {
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={() => {}} />)
    expect(screen.getByRole('button', { name: '+ add' })).toBeDisabled()
  })
})
