import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StagingRow } from './StagingRow'
import type { StagingItem } from '../../hooks/useImportStaging'

const base: StagingItem = {
  id: 's1', file: new File([new Uint8Array([1])], 'Cable_Clip.stl'), name: 'Cable_Clip.stl',
  status: 'ready', sizeBytes: 800_000, dims: { x: 42, y: 18, z: 12 }, plateCount: null,
}

describe('StagingRow', () => {
  it('shows name, dims and size for a ready file', () => {
    render(<StagingRow item={base} />)
    expect(screen.getByText('Cable_Clip.stl')).toBeInTheDocument()
    expect(screen.getByText(/42 × 18 × 12 mm/)).toBeInTheDocument()
    expect(screen.getByText(/781\.3 KB/)).toBeInTheDocument()
    expect(screen.getByText(/parsed/i)).toBeInTheDocument()
  })

  it('shows the error text for a parse-error file', () => {
    render(<StagingRow item={{ ...base, status: 'parse-error', dims: undefined, error: 'Couldn’t parse geometry' }} />)
    expect(screen.getByText(/couldn.t parse geometry/i)).toBeInTheDocument()
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })

  it('appends plate count for a 3mf', () => {
    render(<StagingRow item={{ ...base, name: 'Plate.3mf', plateCount: 3 }} />)
    expect(screen.getByText(/3 plates/)).toBeInTheDocument()
  })
})
