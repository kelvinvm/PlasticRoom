import type { Folder, ModelFile, Tag, UploadFileInput } from './types'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
  return (await res.json()) as T
}

async function parseJsonOrThrow<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
  return (await res.json()) as T
}

export async function uploadFile(input: UploadFileInput): Promise<ModelFile> {
  const form = new FormData()
  form.append('file', input.file)
  for (const id of input.folderIds) form.append('folderIds', String(id))
  for (const id of input.tagIds) form.append('tagIds', String(id))
  const res = await fetch('/api/files', { method: 'POST', body: form })
  return parseJsonOrThrow<ModelFile>(res, '/api/files')
}

export async function uploadThumbnail(fileId: number, pngBlob: Blob): Promise<ModelFile> {
  const url = `/api/files/${fileId}/thumbnail`
  const form = new FormData()
  form.append('file', new File([pngBlob], `${fileId}.png`, { type: 'image/png' }))
  const res = await fetch(url, { method: 'POST', body: form })
  return parseJsonOrThrow<ModelFile>(res, url)
}

export async function createTag(name: string, colorKey: string | null): Promise<Tag> {
  const res = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, colorKey }),
  })
  return parseJsonOrThrow<Tag>(res, '/api/tags')
}

export function getFolders(): Promise<Folder[]> {
  return getJson<Folder[]>('/api/folders')
}

export function getTags(): Promise<Tag[]> {
  return getJson<Tag[]>('/api/tags')
}

export function getFiles(folderId: number | null, q: string): Promise<ModelFile[]> {
  const params = new URLSearchParams()
  if (folderId !== null) {
    params.set('folderId', String(folderId))
  }
  const trimmed = q.trim()
  if (trimmed) {
    params.set('q', trimmed)
  }
  const query = params.toString()
  return getJson<ModelFile[]>(`/api/files${query ? `?${query}` : ''}`)
}

export function getFile(id: number): Promise<ModelFile> {
  return getJson<ModelFile>(`/api/files/${id}`)
}

export function fileContentUrl(id: number): string {
  return `/api/files/${id}/content`
}

export function fileThumbnailUrl(id: number): string {
  return `/api/files/${id}/thumbnail`
}

export function plateThumbnailUrl(id: number, index: number): string {
  return `/api/files/${id}/plates/${index}/thumbnail`
}

export async function updateFileDescription(id: number, description: string): Promise<ModelFile> {
  const url = `/api/files/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}

export async function setFileFolders(id: number, folderIds: number[]): Promise<ModelFile> {
  const url = `/api/files/${id}/folders`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: folderIds }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}

export async function createFolder(name: string, parentId: number | null): Promise<Folder> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  })
  return parseJsonOrThrow<Folder>(res, '/api/folders')
}

export async function batchAssign(
  fileIds: number[],
  addFolderIds: number[],
  addTagIds: number[],
): Promise<ModelFile[]> {
  const url = '/api/files/batch/assign'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds, addFolderIds, addTagIds }),
  })
  return parseJsonOrThrow<ModelFile[]>(res, url)
}
