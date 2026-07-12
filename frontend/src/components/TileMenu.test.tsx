import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TileMenu } from './TileMenu'

describe('TileMenu', () => {
  it('renders a menuitem per item', () => {
    render(<TileMenu items={[{ label: 'Delete', onClick: vi.fn() }, { label: 'Rename', onClick: vi.fn() }]} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })

  it('fires an item onClick when clicked', () => {
    const onClick = vi.fn()
    render(<TileMenu items={[{ label: 'Delete', onClick, danger: true }]} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
