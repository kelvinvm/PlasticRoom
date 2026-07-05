# Phase 6 — Folder/Collection Multi-assign (Screen 3a) — Design Spec

**Goal:** A file can be assigned to any number of folders and system collections at
once via a checkbox-tree modal opened from the "+ add" pill. Checking/unchecking rows
and pressing Save commits the new assignment set; the backend diffs it against the
current assignments.

**Status:** Not started (spec)
**Overview reference:** `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` (Phase 6 / Screen 3a)

---

## Scope & Decisions

- **Folders/collections only.** Tags are out of scope for this modal; single-file tag
  editing stays deferred (inline tag-create on import already exists; batch is Phase 7).
- **System collections are checkable.** Collections (Favorites, Printed, To Print,
  Failed Prints) are ordinary `Folder` rows with `isSystem=true`, so they participate
  in the same assignment. The modal presents them in a distinct **COLLECTIONS** group
  above a **LIBRARY** group, mirroring the Sidebar's split.
- **Backend is unchanged.** `PUT /api/files/{id}/folders` (`FilesController.SetFolders`)
  already performs the full idempotent diff (delete removed `FileFolder` rows, add new
  ones, `PurgeDeletedObjects()`) and returns the updated `ModelFileDto`. Folder creation
  uses the existing `POST /api/folders`. No new endpoints, DTOs, or entities.
- **Minimal inline folder-create.** The footer "+ New folder" creates a folder at root
  (`parentId=null`) and auto-checks it. No parent-picker / nested create in this phase.
- **Independent checkboxes.** Checking a parent folder does NOT cascade to its children,
  and vice-versa. Each row is an independent membership toggle — consistent with
  "assign to any number of folders" and with descendant-inclusive *filtering* being a
  separate, read-side concern (Phase 3).
- **Both surfaces get the pill.** The "+ add" pill appears in Screen 5 (`DetailInfoPanel`,
  the detail-view info panel — already a disabled placeholder) and Screen 1
  (`FileDetailPanel`, the library right panel — currently has no pill; one is added).

---

## Architecture

One self-contained, **controlled** component, reused by both panels:

`frontend/src/components/AssignFoldersModal.tsx` (+ `.module.css`, `.test.tsx`).

**Props:**
- `file: { id: number; name: string; folderIds: number[] }` — enough to seed state,
  render the header, and target the endpoint.
- `folders: Folder[]` — the full flat folder list (system + user).
- `onClose(): void` — cancel / discard.
- `onSaved(updated: ModelFile): void` — assignments committed; host refreshes.
- `onFolderCreated(created: Folder): void` — a new folder was created; host refetches
  its folder list (Sidebar/library) so it appears app-wide.

**Local state only (never lifted):** the working set of checked folder IDs (a
`Set<number>` seeded from `file.folderIds`), per-node expand/collapse state, the
inline-create input value + pending flag, and a save/create error string.

The tree **row** is a small internal sub-component (`FolderCheckRow`) so it can later be
extracted for Phase 7 batch assignment without reworking this modal. No generic `Modal`
primitive is introduced in this phase (YAGNI).

### Reused building blocks
- `buildFolderTree(folders)` from `lib/folderTree.ts` (already unit-tested) →
  `FolderNode[]`, sorted by `sortOrder` then name.
- `fileThumbnailUrl(id)` + the stripe-placeholder `onError` fallback (existing pattern)
  for the header thumbnail.
- The existing API client for `PUT /api/files/{id}/folders` and `POST /api/folders`
  (add client helpers if not already present).

---

## UX / Visual (per overview Screen 3a)

- Modal **760px** wide, centered on a dimmed backdrop.
- **Header:** file thumbnail + file title.
- **Body:** the grouped checkbox tree. Two labelled groups — `COLLECTIONS` (isSystem),
  then `LIBRARY` (the rest). Each group renders its `FolderNode[]` subtree.
  - Real `<input type="checkbox">` per row with an associated `<label>`.
  - Parent folders show an expand/collapse **chevron**; **22px indent per depth level**.
  - **Checked row:** solid orange checkbox + subtle orange row tint.
  - Rows are **expanded by default** for discoverability.
- **Footer:** "+ New folder" link (left) and Cancel / Save (right).
- Follow existing tokens (`styles/tokens.css`): dark surfaces, orange accent, IBM Plex
  Mono for labels/status.

### Accessibility
`role="dialog"` + `aria-modal="true"` + an `aria-label`/labelled title; focus moves into
the modal on open; **Esc** and **backdrop click** cancel (discard). Checkboxes are native
inputs with labels. Errors surface via `role="alert"`.

---

## Data Flow

1. **Open:** "+ add" pill opens the modal; the working set is pre-checked from
   `file.folderIds`.
2. **Toggle:** clicking a row's checkbox adds/removes that folder ID in the working set
   (independent per row — no cascade).
3. **Save:**
   - If the working set equals the original `file.folderIds` (order-insensitive) → just
     `onClose()`; **no network call**.
   - Otherwise `PUT /api/files/{id}/folders` with the full working set (`{ ids: [...] }`).
     On success the server returns the updated `ModelFileDto` → `onSaved(updated)` →
     modal closes.
   - On failure → inline `role="alert"`; modal stays open; working set preserved.
4. **New folder:** footer "+ New folder" reveals a name input. Add/Enter →
   `POST /api/folders { name, parentId: null }`. On success: append the returned folder
   to the local tree, add its ID to the working set (auto-checked), clear the input, and
   call `onFolderCreated`. On failure → inline alert; input preserved.

---

## Wiring the Two Surfaces

- **Screen 5 — `DetailInfoPanel`** (inside `DetailView`): enable the existing pill to
  open the modal. `onSaved` → the existing `reload()` (from `useFile`) so chips refresh;
  `onFolderCreated` → `useFolders().reload()`.
- **Screen 1 — `FileDetailPanel`** (library right panel): add the "+ add" pill (it has
  none today) and thread an `onAssignmentsSaved` callback up to `LibraryView`.
  `LibraryView` refetches its file data on save — reusing the existing key-bump refresh
  pattern (`App` already bumps a `key` on `LibraryView` after import) — so the chips and
  a folder-filtered grid stay correct. `onFolderCreated` likewise triggers the library's
  `useFolders().reload()`.

---

## Testing

**Frontend (Vitest + React Testing Library), `AssignFoldersModal.test.tsx`:**
- Renders the grouped tree from a folder list (COLLECTIONS vs LIBRARY split; nested rows
  indented).
- Pre-checks rows matching `file.folderIds`.
- Toggling a checkbox updates the working set (checked state reflects it).
- Save with changes calls the client with the full working set and fires `onSaved`;
  Save with no changes closes **without** a network call.
- "+ New folder" posts, auto-checks the created folder, and fires `onFolderCreated`.
- A failed Save surfaces `role="alert"` and keeps the modal open.
- Esc / backdrop click cancels via `onClose`.

Reuses the already-tested `buildFolderTree`. Any Vitest file transitively importing
`three` needs the `// @vitest-environment jsdom` docblock — this modal does **not** import
three, so the default env is fine.

**Backend:** no changes → no new backend tests. (`SetFolders` diff behaviour is already
covered by existing `FilesControllerTests`.)

---

## Out of Scope / Deferred

- Tags in this modal (folder-only).
- Nested / parent-selected folder creation (root-only inline create here).
- Parent↔child checkbox cascades.
- Batch multi-file assignment (Phase 7, Screen 4a).
- The folder-cycle guard in `FoldersController.Update` remains deferred to Phase 8; it
  does not affect this modal (assignment, not reparenting).
