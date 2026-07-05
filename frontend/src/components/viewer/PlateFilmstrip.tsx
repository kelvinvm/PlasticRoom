import styles from './PlateFilmstrip.module.css'

export function PlateFilmstrip({
  count,
  activeIndex,
  onSelect,
  thumbnailUrls,
}: {
  count: number
  activeIndex: number | null
  onSelect: (index: number | null) => void
  thumbnailUrls?: (string | null)[]
}) {
  if (count <= 1) return null

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
      {Array.from({ length: count }, (_, i) => {
        const url = thumbnailUrls?.[i] ?? null
        return (
          <button
            key={i}
            type="button"
            className={`${styles.cell} ${activeIndex === i ? styles.active : ''}`}
            aria-pressed={activeIndex === i}
            aria-label={`Plate ${i + 1}`}
            onClick={() => onSelect(i)}
          >
            {url ? (
              <img className={styles.thumb} src={url} alt="" />
            ) : (
              <span className={styles.placeholder} />
            )}
            <span className={styles.index}>{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
