import type { ViewerPlate } from '../../lib/viewerPlates'
import styles from './PlateFilmstrip.module.css'

export function PlateFilmstrip({
  plates,
  activeIndex,
  onSelect,
}: {
  plates: ViewerPlate[]
  activeIndex: number | null
  onSelect: (index: number | null) => void
}) {
  if (plates.length <= 1) return null

  return (
    <div className={styles.strip} role="group" aria-label="Plates">
      <button
        type="button"
        className={`${styles.cell} ${activeIndex === null ? styles.active : ''}`}
        aria-pressed={activeIndex === null}
        aria-label="All plates"
        onClick={() => onSelect(null)}
      >
        <span className={styles.allLabel}>ALL</span>
      </button>
      {plates.map((plate, i) => (
        <button
          key={i}
          type="button"
          className={`${styles.cell} ${activeIndex === i ? styles.active : ''}`}
          aria-pressed={activeIndex === i}
          aria-label={plate.label}
          title={plate.label}
          onClick={() => onSelect(i)}
        >
          {plate.thumbnailUrl ? (
            <img className={styles.thumb} src={plate.thumbnailUrl} alt="" />
          ) : (
            <span className={styles.placeholder} />
          )}
          <span className={styles.index}>{i + 1}</span>
        </button>
      ))}
    </div>
  )
}
