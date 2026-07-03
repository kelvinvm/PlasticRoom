import type { Folder, ModelFile, Tag } from './types'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
  return (await res.json()) as T
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
