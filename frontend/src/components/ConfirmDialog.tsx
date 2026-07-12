import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'
import styles from './ConfirmDialog.module.css'

interface ConfirmDialogProps {
  body: ReactNode
  confirmLabel?: string
  danger?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  body, confirmLabel = 'Delete', danger = false, error = null, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const bodyId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <p id={bodyId} className={styles.body}>{body}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={danger ? styles.confirmDanger : styles.confirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
