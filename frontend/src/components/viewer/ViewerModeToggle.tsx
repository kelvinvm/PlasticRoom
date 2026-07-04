import type { RenderMode } from '../../lib/viewerModes'
import styles from './ViewerModeToggle.module.css'

const MODES: { value: RenderMode; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'plates', label: 'Plates' },
]

export function ViewerModeToggle({
  mode,
  onChange,
}: {
  mode: RenderMode
  onChange: (mode: RenderMode) => void
}) {
  return (
    <div className={styles.toggle} role="group" aria-label="Render mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          className={`${styles.segment} ${m.value === mode ? styles.active : ''}`}
          aria-pressed={m.value === mode}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
