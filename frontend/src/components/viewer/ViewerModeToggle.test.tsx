import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewerModeToggle } from './ViewerModeToggle'

describe('ViewerModeToggle', () => {
  it('renders the three modes and marks the active one', () => {
    render(<ViewerModeToggle mode="solid" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Wireframe' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Plates' })).toBeInTheDocument()
  })

  it('emits the chosen mode on click', () => {
    const onChange = vi.fn()
    render(<ViewerModeToggle mode="solid" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wireframe' }))
    expect(onChange).toHaveBeenCalledWith('wireframe')
  })
})
