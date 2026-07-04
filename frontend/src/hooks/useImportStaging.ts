import { useCallback, useMemo, useState } from 'react'
import type { Tag } from '../api/types'
import type { ModelDims, ThumbnailGenerator } from '../lib/thumbnail'
import { fileTypeFromName } from '../lib/thumbnail'
import { createTag, uploadFile, uploadThumbnail } from '../api/client'

export type StagingStatus =
  | 'parsing' | 'ready' | 'parse-error' | 'importing' | 'imported' | 'import-error'

export interface StagingItem {
  id: string
  file: File
  name: string
  status: StagingStatus
  error?: string
  sizeBytes: number
  dims?: ModelDims
  plateCount: number | null
  thumbnailUrl?: string
  thumbnailBlob?: Blob
}

export interface ImportStagingApi {
  uploadFile: typeof uploadFile
  uploadThumbnail: typeof uploadThumbnail
  createTag: typeof createTag
}

export interface UseImportStagingDeps {
  generate: ThumbnailGenerator
  api: ImportStagingApi
}

const AUTO_TAG_COLORS = ['orange', 'green', 'red', 'brass'] as const

let seq = 0
const nextId = () => `stg-${seq++}`

export function useImportStaging(deps: UseImportStagingDeps) {
  const { generate, api } = deps
  const [items, setItems] = useState<StagingItem[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [importing, setImporting] = useState(false)

  const patch = useCallback((id: string, next: Partial<StagingItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)))
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      const newItems: StagingItem[] = files.map((file) => ({
        id: nextId(),
        file,
        name: file.name,
        status: fileTypeFromName(file.name) ? 'parsing' : 'parse-error',
        error: fileTypeFromName(file.name) ? undefined : 'Unsupported file type',
        sizeBytes: file.size,
        plateCount: null,
      }))
      setItems((prev) => [...prev, ...newItems])

      for (const item of newItems) {
        if (item.status !== 'parsing') continue
        generate(item.file)
          .then((res) => {
            patch(item.id, {
              status: 'ready',
              dims: res.dims,
              plateCount: res.plateCount,
              thumbnailBlob: res.pngBlob,
              thumbnailUrl: URL.createObjectURL(res.pngBlob),
            })
          })
          .catch(() => {
            patch(item.id, { status: 'parse-error', error: 'Couldn’t parse geometry — file may be corrupt' })
          })
      }
    },
    [generate, patch],
  )

  const toggleFolder = useCallback((id: number) => {
    setSelectedFolderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const toggleTag = useCallback((id: number) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const createAndSelectTag = useCallback(
    async (name: string) => {
      const color = AUTO_TAG_COLORS[createdTags.length % AUTO_TAG_COLORS.length]
      const tag = await api.createTag(name, color)
      setCreatedTags((prev) => [...prev, tag])
      setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]))
    },
    [api, createdTags.length],
  )

  const detectedCount = items.length
  const readyItems = useMemo(() => items.filter((it) => it.status === 'ready'), [items])
  const readyCount = readyItems.length
  const failedParseCount = useMemo(
    () => items.filter((it) => it.status === 'parse-error').length,
    [items],
  )
  const allDone = useMemo(
    () => items.length > 0 && items.every((it) => it.status === 'imported' || it.status === 'parse-error'),
    [items],
  )

  const commitOne = useCallback(
    async (item: StagingItem) => {
      patch(item.id, { status: 'importing', error: undefined })
      try {
        const created = await api.uploadFile({
          file: item.file,
          folderIds: selectedFolderIds,
          tagIds: selectedTagIds,
        })
        if (item.thumbnailBlob) {
          try {
            await api.uploadThumbnail(created.id, item.thumbnailBlob)
          } catch {
            // thumbnail is non-fatal: the file is imported regardless
          }
        }
        patch(item.id, { status: 'imported' })
      } catch {
        patch(item.id, { status: 'import-error', error: 'Upload failed' })
      }
    },
    [api, patch, selectedFolderIds, selectedTagIds],
  )

  const commitBatch = useCallback(
    async (targets: StagingItem[]) => {
      setImporting(true)
      try {
        for (const item of targets) {
          await commitOne(item)
        }
      } finally {
        setImporting(false)
      }
    },
    [commitOne],
  )

  const importAll = useCallback(
    () => commitBatch(items.filter((it) => it.status === 'ready')),
    [commitBatch, items],
  )

  const retryFailed = useCallback(
    () => commitBatch(items.filter((it) => it.status === 'import-error')),
    [commitBatch, items],
  )

  return {
    items,
    addFiles,
    detectedCount,
    readyCount,
    failedParseCount,
    selectedFolderIds,
    toggleFolder,
    selectedTagIds,
    toggleTag,
    createdTags,
    createAndSelectTag,
    importAll,
    retryFailed,
    importing,
    allDone,
  }
}
