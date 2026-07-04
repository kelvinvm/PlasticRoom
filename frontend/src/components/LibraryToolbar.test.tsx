import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryToolbar } from './LibraryToolbar'

describe('LibraryToolbar', () => {
  it('renders the title and file count', () => {
    render(<LibraryToolbar title="Miniatures" fileCount={42} search="" onSearchChange={vi.fn()} />)
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('42 files')).toBeInTheDocument()
  })

  it('calls onSearchChange as the user types', () => {
    const onChange = vi.fn()
    render(<LibraryToolbar title="Miniatures" fileCount={0} search="" onSearchChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'dragon' } })
    expect(onChange).toHaveBeenCalledWith('dragon')
  })
})
