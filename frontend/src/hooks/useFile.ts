import { useCallback, useEffect, useState } from 'react'
import type { ModelFile } from '../api/types'
import { getFile } from '../api/client'

export function useFile(id: number | null): {
  file: ModelFile | null
  loading: boolean
  error: boolean
  reload: () => void
} {
  const [file, setFile] = useState<ModelFile | null>(null)
  const [loading, setLoading] = useState(id !== null)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (id === null) {
      setFile(null)
      setLoading(false)
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    getFile(id)
      .then((data) => {
        if (!cancelled) setFile(data)
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setFile(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, nonce])

  return { file, loading, error, reload }
}
