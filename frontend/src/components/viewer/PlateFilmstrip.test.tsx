import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlateFilmstrip } from './PlateFilmstrip'
import type { ViewerPlate } from '../../lib/viewerPlates'

const plates: ViewerPlate[] = [
  { label: 'Corners', thumbnailUrl: '/api/files/7/plates/1/thumbnail', objectIndices: [0, 2] },
  { label: 'Base', thumbnailUrl: null, objectIndices: [1] },
]

describe('PlateFilmstrip', () => {
  it('renders nothing for a single plate', () => {
    const { container } = render(
      <PlateFilmstrip plates={[plates[0]]} activeIndex={null} onSelect={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an All control plus one cell per plate, labelled by plate name', () => {
    render(<PlateFilmstrip plates={plates} activeIndex={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'All plates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corners' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Base' })).toBeInTheDocument()
  })

  it('shows a thumbnail image when a url is given, placeholder otherwise', () => {
    const { container } = render(
      <PlateFilmstrip plates={plates} activeIndex={null} onSelect={() => {}} />,
    )
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', '/api/files/7/plates/1/thumbnail')
  })

  it('marks the active plate pressed and emits its index; All emits null', () => {
    const onSelect = vi.fn()
    render(<PlateFilmstrip plates={plates} activeIndex={0} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Corners' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Base' }))
    expect(onSelect).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'All plates' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
