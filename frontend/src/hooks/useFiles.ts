import { useEffect, useState } from 'react'
import type { ModelFile } from '../api/types'
import { getFiles } from '../api/client'

export function useFiles(
  folderId: number | null,
  q: string,
): { files: ModelFile[]; loading: boolean; error: boolean; reload: () => void } {
  const [files, setFiles] = useState<ModelFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFiles(folderId, q)
      .then((data) => {
        if (!cancelled) setFiles(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [folderId, q, reloadIndex])

  return { files, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
