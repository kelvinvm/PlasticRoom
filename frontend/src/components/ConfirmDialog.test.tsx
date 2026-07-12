import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders the body and default Delete/Cancel buttons', () => {
    render(<ConfirmDialog body="Delete X?" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Delete X?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('is an accessible modal dialog described by its body', () => {
    render(<ConfirmDialog body="Delete X?" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const descId = dialog.getAttribute('aria-describedby')
    expect(screen.getByText('Delete X?')).toHaveAttribute('id', descId!)
  })

  it('fires onConfirm from the confirm button (respecting confirmLabel)', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog body="x" confirmLabel="Remove" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('fires onCancel on Cancel, backdrop click, and Escape', () => {
    const onCancel = vi.fn()
    const { container } = render(<ConfirmDialog body="x" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(container.firstChild as HTMLElement) // backdrop
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('renders an error message when provided', () => {
    render(<ConfirmDialog body="x" error="Could not delete." onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Could not delete.')).toBeInTheDocument()
  })
})
