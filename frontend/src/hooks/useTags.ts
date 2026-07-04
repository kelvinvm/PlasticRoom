import { useEffect, useState } from 'react'
import type { Tag } from '../api/types'
import { getTags } from '../api/client'

export function useTags(): { tags: Tag[]; loading: boolean; error: boolean } {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
  }, [])

  return { tags, loading, error }
}
