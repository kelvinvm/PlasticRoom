import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useTags } from './useTags'
import * as client from '../api/client'

describe('useTags', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refetches tags when reload is called', async () => {
    const spy = vi.spyOn(client, 'getTags').mockResolvedValue([])
    const { result } = renderHook(() => useTags())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.reload())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
