import type { StagingItem } from '../../hooks/useImportStaging'
import { formatBytes, formatDimensions } from '../../lib/format'
import styles from './StagingRow.module.css'

const STATUS_LABEL: Record<StagingItem['status'], string> = {
  parsing: 'parsing…',
  ready: '✓ parsed',
  'parse-error': '✕ error',
  importing: 'importing…',
  imported: '✓ imported',
  'import-error': '✕ failed',
}

function metaLine(item: StagingItem): string {
  if (item.status === 'parse-error' || item.status === 'import-error') {
    return item.error ?? 'Something went wrong'
  }
  const parts: string[] = []
  const dims = item.dims ? formatDimensions(item.dims.x, item.dims.y, item.dims.z) : null
  if (dims) parts.push(dims)
  parts.push(formatBytes(item.sizeBytes))
  if (item.plateCount && item.plateCount > 1) parts.push(`${item.plateCount} plates`)
  return parts.join(' · ')
}

export function StagingRow({ item }: { item: StagingItem }) {
  const bad = item.status === 'parse-error' || item.status === 'import-error'
  return (
    <div className={styles.row}>
      <div className={styles.thumb} aria-hidden>
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className={styles.img} /> : null}
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{item.name}</div>
        <div className={`${styles.meta} ${bad ? styles.metaBad : ''}`}>{metaLine(item)}</div>
      </div>
      <div className={`${styles.status} ${bad ? styles.statusBad : styles.statusOk}`}>
        {STATUS_LABEL[item.status]}
      </div>
    </div>
  )
}
