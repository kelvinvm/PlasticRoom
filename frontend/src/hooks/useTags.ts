import { useEffect, useState } from 'react'
import type { Tag } from '../api/types'
import { getTags } from '../api/client'

export function useTags(): { tags: Tag[]; loading: boolean; error: boolean; reload: () => void } {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getTags()
      .then((data) => {
        if (!cancelled) setTags(data)
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

  return { tags, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
