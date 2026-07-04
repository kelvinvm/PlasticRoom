import { useEffect, useState } from 'react'
import type { Folder } from '../api/types'
import { getFolders } from '../api/client'

export function useFolders(): { folders: Folder[]; loading: boolean; error: boolean } {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
  }, [])

  return { folders, loading, error }
}
