import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a connecting state before the health check resolves', () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    )

    render(<App />)

    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })

  it('shows Connected when /api/health responds ok', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', db: 'connected' }),
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/health')
  })

  it('shows Connection failed when /api/health rejects', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error'),
    )

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Connection failed')).toBeInTheDocument(),
    )
  })

  it('shows Connection failed when /api/health responds with a non-ok status', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ status: 'error', db: 'failed' }),
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Connection failed')).toBeInTheDocument(),
    )
  })
})
