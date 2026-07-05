import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlateFilmstrip } from './PlateFilmstrip'

describe('PlateFilmstrip', () => {
  it('renders nothing for a single plate', () => {
    const { container } = render(<PlateFilmstrip count={1} activeIndex={null} onSelect={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one cell per plate plus an All control for multi-plate', () => {
    render(<PlateFilmstrip count={3} activeIndex={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'All plates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plate 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plate 3' })).toBeInTheDocument()
  })

  it('marks the active plate pressed and emits its index on click', () => {
    const onSelect = vi.fn()
    render(<PlateFilmstrip count={2} activeIndex={0} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Plate 1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Plate 2' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('All plates emits null', () => {
    const onSelect = vi.fn()
    render(<PlateFilmstrip count={2} activeIndex={1} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'All plates' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('renders a thumbnail image per cell when urls are provided, placeholder otherwise', () => {
    const { container } = render(
      <PlateFilmstrip
        count={2}
        activeIndex={null}
        onSelect={() => {}}
        thumbnailUrls={['data:image/png;base64,AAA', null]}
      />,
    )
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', 'data:image/png;base64,AAA')
  })
})
