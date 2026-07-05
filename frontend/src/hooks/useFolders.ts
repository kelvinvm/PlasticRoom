import { useEffect, useState } from 'react'
import type { Folder } from '../api/types'
import { getFolders } from '../api/client'

export function useFolders(): { folders: Folder[]; loading: boolean; error: boolean; reload: () => void } {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFolders()
      .then((data) => {
        if (!cancelled) setFolders(data)
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
  }, [reloadIndex])

  return { folders, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
