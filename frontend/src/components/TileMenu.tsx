import styles from './TileMenu.module.css'

export interface TileMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export function TileMenu({ items }: { items: TileMenuItem[] }) {
  return (
    <div className={styles.menu} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? styles.itemDanger : styles.item}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
