import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryToolbar } from './LibraryToolbar'

describe('LibraryToolbar', () => {
  it('renders the title and file count', () => {
    render(<LibraryToolbar title="Miniatures" fileCount={42} selectedCount={0} search="" onSearchChange={vi.fn()} activeTags={[]} onRemoveTag={vi.fn()} />)
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('42 files')).toBeInTheDocument()
  })

  it('shows the selected count when 2+ files are selected', () => {
    render(<LibraryToolbar title="Miniatures" fileCount={42} selectedCount={3} search="" onSearchChange={vi.fn()} activeTags={[]} onRemoveTag={vi.fn()} />)
    expect(screen.getByText('3 files selected of 42')).toBeInTheDocument()
  })

  it('calls onSearchChange as the user types', () => {
    const onChange = vi.fn()
    render(<LibraryToolbar title="Miniatures" fileCount={0} selectedCount={0} search="" onSearchChange={onChange} activeTags={[]} onRemoveTag={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'dragon' } })
    expect(onChange).toHaveBeenCalledWith('dragon')
  })

  it('renders active tag chips and removes one on click', () => {
    const onRemoveTag = vi.fn()
    render(
      <LibraryToolbar
        title="All Files"
        fileCount={3}
        selectedCount={0}
        search=""
        onSearchChange={vi.fn()}
        activeTags={[{ id: 11, name: 'Printed', colorKey: 'orange' }]}
        onRemoveTag={onRemoveTag}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Printed/ }))
    expect(onRemoveTag).toHaveBeenCalledWith(11)
  })
})
