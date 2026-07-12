# File Tile Actions Menu (kebab) — Design

**Date:** 2026-07-12
**Status:** Approved, pending implementation plan
**Branch:** `tile-actions-menu`

## Goal

Add a 3-dot (kebab) actions menu to every file tile in the library grid, with **Delete** as its first action. The menu is designed to grow — future actions are added as simple entries, not new plumbing. Deleting a file is permanent (removes the DB record and the on-disk original + thumbnail), so it is guarded by a confirmation dialog.

## Decisions (locked during brainstorming)

1. **Confirmation:** Delete opens a confirm dialog (Cancel / Delete). No immediate-delete, no undo/soft-delete (backend has no soft-delete today).
2. **Kebab visibility:** Always visible, in each tile's top-right corner.
3. **Delete scope:** The kebab menu always acts on its own tile's file, independent of the current multi-selection. Batch delete is out of scope (a possible later addition to the multi-select panel).
4. **Reuse:** Extract a shared `ConfirmDialog` and migrate the existing Sidebar folder-delete onto it in the same change.

## Current state (context)

- `frontend/src/components/FileGrid.tsx` — each tile's outer element is a `<button>` (handles select on click, open on double-click, `aria-current`, keyboard). A nested interactive button would be invalid HTML, so the kebab must sit outside that button in the DOM.
- Multi-select model (Phase 7): `selectedFileIds: ReadonlySet<number>`; when 2+ selected, unselected tiles dim and selected tiles show a top-left ✓ badge.
- `frontend/src/views/LibraryView.tsx` owns the `Selection` and `reloadFiles` (from `useFiles`).
- `frontend/src/api/client.ts` has `deleteFolder` but **no `deleteFile`**.
- Backend `DELETE /api/files/{id}` already exists (`FilesController.Delete`) — removes the record and cleans up the on-disk original + thumbnail. **No backend change needed.**
- `frontend/src/components/Sidebar.tsx` has an inline delete-confirm modal + the just-shipped context-menu pattern (single `openMenuId`, dismiss on outside-click/Escape) that the tile menu mirrors.

## Architecture

### Component structure

```
FileGrid                      owns openMenuId (single menu open), dismiss effect
  └─ div.cardWrap  (position: relative)   ← new wrapper per tile
       ├─ button.card         (unchanged: select / open / aria / keyboard)
       ├─ button.kebab        (new: always-visible, top-right; aria-haspopup="menu")
       └─ TileMenu            (new: rendered only when this tile's menu is open)
```

- **`div.cardWrap`** — new positioning container so the kebab and menu can be absolutely positioned relative to the tile without disturbing the card button.
- **`button.kebab`** — always visible, top-right corner, `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-label={`Actions for ${file.name}`}`. `onClick` calls `stopPropagation()` (so it never selects/opens the card) and toggles this tile's menu via the lifted `openMenuId`.
- **`TileMenu`** (`components/TileMenu.tsx`) — presentational `role="menu"` rendered from a declarative array:
  ```ts
  interface TileMenuItem { label: string; onClick: () => void; danger?: boolean }
  ```
  Renders one `role="menuitem"` button per item; `danger` items use the error color. Today the only item is Delete. Adding future actions = appending to the array built in `FileCard`.

### Open-state management (mirrors Sidebar)

- `FileGrid` holds `openMenuId: number | null`. The kebab toggles it (clicking the open tile's kebab closes it; clicking another tile's kebab switches — single menu open at a time).
- A `useEffect` keyed on `openMenuId` adds `document` `click` and `keydown` (Escape) listeners that close the menu, and cleans them up. (Kebab `stopPropagation` prevents its own opening click from immediately closing.)

### Delete flow

1. The Delete `TileMenuItem`'s `onClick` closes the menu and calls `onRequestDelete(file)`.
2. `onRequestDelete` bubbles up: `FileCard` → `FileGrid` (new prop `onRequestDelete: (file: ModelFile) => void`) → `LibraryView`.
3. `LibraryView` sets `pendingDeleteFile: ModelFile | null` and renders `<ConfirmDialog>` with a body like *Delete "{name}"? This permanently removes the file.*
4. On **confirm**: `await deleteFile(file.id)` → on success `reloadFiles()`, drop `file.id` from `selection`, clear `pendingDeleteFile`. On failure: keep `pendingDeleteFile`, pass an `error` string to `ConfirmDialog` (dialog stays open, shows the error), file untouched.
5. On **cancel** (button, backdrop, or Esc): clear `pendingDeleteFile`, no network call.

New client fn (mirrors `deleteFolder`):
```ts
export async function deleteFile(id: number): Promise<void> {
  const res = await fetch(`/api/files/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}
```

### `ConfirmDialog` (new shared component)

`components/ConfirmDialog.tsx`, extracted from the Sidebar's inline modal:

```ts
interface ConfirmDialogProps {
  body: React.ReactNode
  confirmLabel?: string      // default "Delete"
  danger?: boolean           // red confirm button; default false. Both current callers (file + folder delete) pass danger.
  error?: string | null      // rendered inside the dialog when a confirm attempt fails
  onConfirm: () => void
  onCancel: () => void
}
```

- Renders backdrop + dialog; `role="dialog"`, `aria-modal="true"`, `aria-describedby` tied to the body. Backdrop click and Escape call `onCancel`. Confirm button calls `onConfirm`.
- Presentational only — the owner performs the async delete and decides when to close (on success) or keep open with `error` (on failure). This keeps the dialog reusable.
- **Sidebar migration:** replace the inline modal JSX in `Sidebar.tsx` with `<ConfirmDialog>`, keeping the existing `pendingDelete`/`confirmDelete` logic and error surface. Sidebar's existing delete tests must continue to pass.

## Error handling

- **Delete network failure:** dialog stays open with an inline error; the file remains; selection unchanged.
- **Kebab vs card interaction:** kebab `stopPropagation` guarantees opening the menu never selects or opens the tile.
- **Deleting a selected file:** its id is removed from `selection` after a successful delete so no stale selection lingers. (If it was one of 2+ selected, the batch panel/count updates naturally via the selection change.)

## Testing

- **`FileGrid` (RTL):** every tile renders a kebab; clicking the kebab opens the menu; the Delete item calls `onRequestDelete` with the right file; Escape and outside-click dismiss the menu; opening a second tile's menu closes the first (single-open); kebab click does not trigger select/open.
- **`LibraryView` (RTL, new `LibraryView.test.tsx`):** kebab → Delete → confirm calls `deleteFile(id)` then `reloadFiles`, and drops the id from selection; cancel makes no call; a rejected `deleteFile` keeps the dialog open and shows an error.
- **`ConfirmDialog` (RTL):** renders body/labels; confirm/cancel/backdrop/Esc fire the right callbacks; `error` renders; a11y attributes present.
- **`Sidebar` (RTL):** existing folder-delete tests stay green after migrating to `ConfirmDialog`.

## Files

**New**
- `frontend/src/components/TileMenu.tsx` (+ `TileMenu.module.css`)
- `frontend/src/components/ConfirmDialog.tsx` (+ `ConfirmDialog.module.css`)
- `frontend/src/components/TileMenu.test.tsx`, `frontend/src/components/ConfirmDialog.test.tsx`

**Modified**
- `frontend/src/api/client.ts` — add `deleteFile`
- `frontend/src/components/FileGrid.tsx` (+ `FileGrid.module.css`) — cardWrap, kebab, TileMenu wiring, `openMenuId`, `onRequestDelete` prop
- `frontend/src/views/LibraryView.tsx` — `pendingDeleteFile`, `ConfirmDialog`, delete handler + selection cleanup
- `frontend/src/components/Sidebar.tsx` — use `ConfirmDialog`
- `frontend/src/components/FileGrid.test.tsx` — kebab/menu coverage
- `frontend/src/views/LibraryView.test.tsx` — **new** file for the delete-flow coverage

**Backend:** none.

## Out of scope (future)

- Additional menu actions (the menu is built to take them — e.g. Rename, Move, Duplicate, Open).
- Batch delete for a multi-selection.
- Soft-delete / undo / trash.
- Kebab on the file **detail** view (grid tiles only).
