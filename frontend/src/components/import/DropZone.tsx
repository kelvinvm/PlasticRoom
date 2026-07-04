import { useRef, useState } from 'react'
import styles from './DropZone.module.css'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export function DropZone({ onFiles, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      className={`${styles.zone} ${over ? styles.over : ''} ${disabled ? styles.disabled : ''}`}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
      onClick={() => { if (!disabled) inputRef.current?.click() }}
    >
      <div className={styles.icon} aria-hidden>⬇</div>
      <div className={styles.title}>Drop 3MF / STL files here, or click to browse</div>
      <div className={styles.sub}>Metadata (dimensions, plates) is parsed automatically</div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".3mf,.stl"
        hidden
        onChange={(e) => { emit(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
