import { useEffect, useState } from 'react'
import type { ModelFile } from '../api/types'
import { getFiles } from '../api/client'

export function useFiles(
  folderId: number | null,
  q: string,
): { files: ModelFile[]; loading: boolean; error: boolean } {
  const [files, setFiles] = useState<ModelFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
  }, [folderId, q])

  return { files, loading, error }
}
