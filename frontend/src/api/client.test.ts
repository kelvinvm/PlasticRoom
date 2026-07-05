import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchAssign, createFolder, createTag, getFiles, getFolders, plateThumbnailUrl, setFileFolders, uploadFile, uploadThumbnail } from './client'

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

describe('upload + tag mutations', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('uploadFile POSTs multipart with file + repeated folder/tag ids', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 1 }))
    const file = new File([new Uint8Array([1, 2, 3])], 'a.stl', { type: 'model/stl' })

    await uploadFile({ file, folderIds: [3, 4], tagIds: [7] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files')
    expect(init.method).toBe('POST')
    const body = init.body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.getAll('folderIds')).toEqual(['3', '4'])
    expect(body.getAll('tagIds')).toEqual(['7'])
  })

  it('uploadThumbnail POSTs the png under field "file" to the id route', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 9 }))
    const blob = new Blob([new Uint8Array([0])], { type: 'image/png' })

    await uploadThumbnail(9, blob)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/9/thumbnail')
    expect(init.method).toBe('POST')
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('createTag POSTs JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 5, name: 'Resin', colorKey: 'orange' }))

    const tag = await createTag('Resin', 'orange')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tags')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ name: 'Resin', colorKey: 'orange' })
    expect(tag.id).toBe(5)
  })

  it('throws when upload response is not ok', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 400 } as Response)
    const file = new File([new Uint8Array([1])], 'a.stl')
    await expect(uploadFile({ file, folderIds: [], tagIds: [] })).rejects.toThrow()
  })
})

describe('folder mutations', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('setFileFolders PUTs the id list as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 7 }))

    await setFileFolders(7, [3, 5])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/7/folders')
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ ids: [3, 5] })
  })

  it('createFolder POSTs name + parentId as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 9, name: 'Dragons', parentId: null }))

    const folder = await createFolder('Dragons', null)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/folders')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Dragons', parentId: null })
    expect(folder.id).toBe(9)
  })
})

describe('batch assign', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('batchAssign POSTs fileIds + add ids as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson([{ id: 1 }, { id: 2 }]))

    const updated = await batchAssign([1, 2], [7], [4])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/batch/assign')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ fileIds: [1, 2], addFolderIds: [7], addTagIds: [4] })
    expect(updated).toHaveLength(2)
  })
})

describe('plateThumbnailUrl', () => {
  it('builds the plate thumbnail path', () => {
    expect(plateThumbnailUrl(7, 3)).toBe('/api/files/7/plates/3/thumbnail')
  })
})
