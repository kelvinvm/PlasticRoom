import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

describe('DropZone', () => {
  it('calls onFiles with dropped files', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} />)
    const file = new File([new Uint8Array([1])], 'a.stl')
    const zone = screen.getByText(/drop 3mf/i).closest('div')!
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('calls onFiles from the file input', () => {
    const onFiles = vi.fn()
    const { container } = render(<DropZone onFiles={onFiles} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'b.3mf')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('does not fire when disabled', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} disabled />)
    const file = new File([new Uint8Array([1])], 'a.stl')
    const zone = screen.getByText(/drop 3mf/i).closest('div')!
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
