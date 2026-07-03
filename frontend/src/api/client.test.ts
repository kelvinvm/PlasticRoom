import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFiles, getFolders } from './client'

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('getFolders requests /api/folders', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson([]))
    await getFolders()
    expect(fetch).toHaveBeenCalledWith('/api/folders')
  })

  it('getFiles with folderId and query builds the query string', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson([]))
    await getFiles(7, 'dragon')
    expect(fetch).toHaveBeenCalledWith('/api/files?folderId=7&q=dragon')
  })

  it('getFiles with null folder and blank query hits the bare endpoint', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson([]))
    await getFiles(null, '   ')
    expect(fetch).toHaveBeenCalledWith('/api/files')
  })

  it('throws when the response is not ok', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 } as Response)
    await expect(getFolders()).rejects.toThrow()
  })
})
