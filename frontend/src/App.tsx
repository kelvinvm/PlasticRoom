import { useEffect, useState } from 'react'

type Status = 'loading' | 'connected' | 'error'

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  loading: { label: 'Connecting…', color: 'rgba(242,237,228,.35)' },
  connected: { label: 'Connected', color: '#3ddc97' },
  error: { label: 'Connection failed', color: '#e0654a' },
}

export default function App() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let cancelled = false

    fetch('/api/health')
      .then((res) => {
        if (cancelled) return
        setStatus(res.ok ? 'connected' : 'error')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const { label, color } = STATUS_CONFIG[status]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: '#0f0e0c',
        fontFamily: "'IBM Plex Sans', sans-serif",
        color: '#f2ede4',
      }}
    >
      <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 16 }}>
        PlasticRoom
      </h1>
      <span style={{ fontSize: 13, color }}>{label}</span>
    </div>
  )
}
