import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFolders } from './useFolders'
import * as client from '../api/client'

describe('useFolders', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refetches folders when reload is called', async () => {
    const spy = vi.spyOn(client, 'getFolders').mockResolvedValue([])
    const { result } = renderHook(() => useFolders())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.reload())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
