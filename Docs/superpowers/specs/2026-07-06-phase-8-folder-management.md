# Phase 8 — Folder Management (Screen 6a, adapted) — Design Spec

**Goal:** Let the user edit the LIBRARY folder tree directly in the existing Sidebar —
rename, reorder, re-nest (move), and delete folders — plus expand/collapse rows and see a
per-folder file count. This is the final phase; it completes the folder-management
capability promised by Screen 6a.

**Status:** Not started (spec)
**Overview reference:** `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` (Phase 8 / Screen 6a)

---

## Scope & Decisions

- **Inline editing in the EXISTING Sidebar — no separate full-screen view.** This
  intentionally diverges from the Screen 6a mockup (which specced a dedicated screen with a
  right-panel folder detail editor). All management happens in place in the left Sidebar.
- **LIBRARY (non-system) folders only are editable.** COLLECTIONS (`IsSystem`) rows stay
  locked: they render the new chevrons + file counts (read-only) but get **no** drag handle,
  rename, or context menu. The backend already blocks rename/reparent/delete on system
  folders; the frontend simply doesn't offer those affordances.
- **Rename only — no description / cover / right-panel editing.** Editing a folder means
  renaming it (label → inline text input). Per-folder description editing and cover images
  are out of scope (cover images deferred entirely → `Docs/future-refinements.md` #5).
- **Move via native HTML5 drag-and-drop.** Reorder between siblings and re-nest by dropping
  onto a folder. Chosen over menu-driven and over `@dnd-kit`. Keyboard / screen-reader move
  is **deferred** (logged as future-refinement #6); this is a single-user local app.
- **Reorder persists via a new atomic batch endpoint** `PUT /api/folders/order`, not N
  per-folder PUTs — one drag commits as a single transaction, no partial-tree states.
- **Chevrons + file counts are both included** (full Screen 6a row treatment). Collapse
  state is **ephemeral** component state (not persisted across reloads); default expanded.
- **File count = direct assignments** (files whose `FileFolder` join points at that folder),
  NOT descendant-inclusive. Predictable and cheap. (Note: the library *grid* filter is
  descendant-inclusive — the Sidebar count deliberately differs and is the direct count.)
- **Delete cascades, with confirmation.** Deleting a folder removes its descendant folders
  and all their `FileFolder` join rows; the files themselves are never deleted (they just
  lose the assignment). A confirm dialog states this before the destructive call.

---

## Architecture

### Backend — `FoldersController` + `FolderDto`

Three changes; delete needs **no** change (existing `DeleteFolderRecursive` already cascades
correctly).

#### 1. `PUT /api/folders/order` (new, atomic batch)

Request body:

```csharp
public record ReorderFoldersRequest(List<FolderOrderItem> Items);
public record FolderOrderItem(int Id, int? ParentId, int SortOrder);
```

Behavior:

1. **Validate up front, before any write.** For each item: the folder must exist (else
   `404`) and must be **non-system** (else `400` — system folders can't be reordered/moved).
   If `ParentId` is set, the parent must exist (else `404`).
2. **Cycle guard** (see shared helper below): reject if any item's new `ParentId` is the
   folder itself or one of its current descendants → `400`.
3. Only after all validation passes: `session.BeginTransaction()`, set each folder's
   `ParentFolder` (via `GetObjectByKey`, or `null` for root) and `SortOrder`, `Save()` each,
   then `session.CommitTransaction()`.
4. No `Delete()` calls → no `PurgeDeletedObjects()`. (Follows the project XPO rule: explicit
   `BeginTransaction` before `CommitTransaction`.)
5. Return `Ok(...)` with the full updated folder list (same shape as `GetAll`), so the client
   can reconcile from the server.

Empty / missing `Items` → `400`.

#### 2. Cycle guard added to the existing `Update`

`FoldersController.Update` currently sets `folder.ParentFolder = parent` with no ancestor
check — this is the folder-cycle hole deferred from Phase 3 (which the `FilesController`
descendant traversal has a `HashSet` visited-guard to survive). Add the same cycle guard
here: when `request.ParentId` is set, reject with `400` if the new parent is the folder
itself or one of its descendants (walk `folder.Children` recursively; the target parent must
not appear).

Extract a shared static helper, e.g. `WouldCreateCycle(Folder folder, int newParentId)`,
used by both `Update` and the order endpoint.

#### 3. `fileCount` on `FolderDto`

Add a `FileCount` field to `FolderDto`, populated in `ToDto` from the folder's **direct**
`FileFolder` count (`folder.FileFolders.Count`). Surfaces on every folder in `GetAll`, the
create/update responses, and the order-endpoint response.

```csharp
public record FolderDto(int Id, string Name, int? ParentId, string? Description,
                        int? CoverImageFileId, int SortOrder, bool IsSystem, int FileCount);
```

### Frontend — pure logic (unit-tested, UI-free)

#### `lib/folderMove.ts`

```ts
type DropPosition =
  | { kind: 'onto'; folderId: number }                 // re-nest as child of folderId
  | { kind: 'between'; parentId: number | null; index: number }; // reorder among siblings

function computeFolderMove(
  tree: FolderNode[],       // library (non-system) tree only
  dragId: number,
  drop: DropPosition,
): FolderOrderItem[]         // minimal { id, parentId, sortOrder } deltas
```

- Renumbers the affected sibling group's `sortOrder` so the dragged folder lands at the
  requested position; emits deltas only for folders whose `parentId` or `sortOrder` changed.
- **Refuses illegal moves** (returns `[]`): dropping a folder onto itself, or onto one of its
  own descendants (mirrors the server cycle guard so the UI never sends a doomed request).
- Pure and fully unit-tested — no DOM, no `three`, no network.

#### `lib/folderTree.ts` — sort by `SortOrder`

`buildFolderTree` must sort each node's `children` by `SortOrder` ascending, with `name` as
the tiebreak. Today it does not sort by `SortOrder`, so reorders would not render. (This
affects LIBRARY and COLLECTIONS trees identically; harmless for collections.) Existing
`buildFolderTree` tests extended to cover ordering.

### Frontend — Sidebar restructure

`FolderRow` (today a bare, always-expanded `<button>`) is restructured to carry:

- **Chevron** for rows with children — toggles the folder's id in an ephemeral
  `collapsed: Set<number>` held in `Sidebar`; collapsed folders don't render their children.
  Default expanded. Not persisted across reloads. Rows with no children show no chevron
  (indent preserved).
- **File count** — right-aligned, IBM Plex Mono, from `folder.fileCount`.
- **Drag-and-drop (LIBRARY only):** `draggable`, `onDragStart` / `onDragOver` / `onDrop` /
  `onDragEnd`. Drop-target highlight distinguishes *onto-folder* (re-nest — highlight the row)
  from *between-rows* (reorder — an insertion line between siblings). On drop → build a
  `DropPosition` → `computeFolderMove` → if non-empty, `reorderFolders(items)` →
  `reloadFolders()`.
- **Inline rename (LIBRARY only):** entered via the context menu (or double-click on the
  label). Label becomes a text input seeded with the current name; **Enter or blur commits**
  via `updateFolder(id, { name })`; **Esc cancels** with no request. Empty/whitespace name is
  rejected (revert to prior name).
- **Right-click context menu (LIBRARY only):** **Rename**, **Delete**. ("Move to…" and other
  keyboard-accessible move paths are deferred → refinements #6.) Closes on outside click / Esc.
- **Delete (LIBRARY only):** opens a confirm dialog: *"Delete '<name>' and its subfolders?
  Files stay in your library but lose this folder assignment."* On confirm →
  `deleteFolder(id)` → `reloadFolders()` **and** `reloadFiles()` (the grid may change if the
  currently selected folder or a descendant was deleted; if the selected folder was deleted,
  selection falls back to All Files).

COLLECTIONS rows: chevrons + counts only; no drag, rename, or context menu.

`Sidebar`'s props grow to accept `reloadFolders` and `reloadFiles` (both already exist on the
`useFolders` / `useFiles` hooks from Phase 6). `App`/`LibraryView` wires them through.

### Frontend — API client (`api/client.ts`)

Three new functions (all reuse or extend existing endpoints):

- `reorderFolders(items: FolderOrderItem[]): Promise<Folder[]>` → `PUT /api/folders/order`.
- `updateFolder(id, patch: { name?: string; parentId?: number | null }): Promise<Folder>` →
  existing `PUT /api/folders/{id}`.
- `deleteFolder(id: number): Promise<void>` → existing `DELETE /api/folders/{id}`.

`Folder` TS type gains `fileCount: number` (mirrors the DTO).

---

## Data Flow

1. **Rename:** context menu → inline input → Enter/blur → `updateFolder(id, {name})` →
   `reloadFolders()`.
2. **Reorder / re-nest:** drag row → drop → `computeFolderMove` → `reorderFolders(items)`
   (one atomic PUT) → `reloadFolders()`. Server is source of truth; the reload paints the
   authoritative order.
3. **Delete:** context menu → confirm dialog → `deleteFolder(id)` → `reloadFolders()` +
   `reloadFiles()`; reset selection to All Files if the selected folder was removed.
4. **Collapse/expand:** pure client state toggle in `Sidebar`; no network.

---

## Error Handling

- Any failed rename / reorder / delete surfaces a `role="alert"` message and **reloads the
  tree from the server** to reconcile the optimistic UI back to truth.
- The order endpoint is atomic: a rejected reorder (cycle, system folder, unknown id) leaves
  the tree untouched, and the client reload restores the pre-drag rendering.
- Client-side `computeFolderMove` refuses descendant/self drops, so the common illegal move
  never reaches the server; the server guard is the backstop.

---

## Testing

**Backend (xUnit):**
- `PUT /api/folders/order`: happy path (reorder + re-nest persists `ParentId`/`SortOrder`);
  system-folder id → `400`, nothing written; unknown id → `404`, nothing written; unknown
  parent → `404`; cycle (parent is self or descendant) → `400`, nothing written; empty
  `Items` → `400`.
- `Update`: reparent into a descendant → `400` (new cycle guard); legal reparent still works.
- `fileCount`: a folder with N direct file assignments reports `FileCount == N`; descendant
  assignments do NOT inflate it.

**Frontend (Vitest):**
- `computeFolderMove`: reorder among siblings (sortOrder renumbering), re-nest onto a folder
  (parentId change), drop onto self → `[]`, drop onto own descendant → `[]`, minimal-delta
  output.
- `buildFolderTree`: children sorted by `SortOrder` then name.
- `Sidebar`: rename commit (Enter/blur) + cancel (Esc); context menu shows Rename/Delete for
  LIBRARY rows and is absent for COLLECTIONS; chevron collapse hides children; delete confirm
  dialog copy + calls `deleteFolder` + reloads on confirm, no-ops on cancel; file count renders.
- **Not unit-tested (verified by running the app, per WebGL/DnD precedent):** the native
  HTML5 drag gestures themselves — jsdom does not implement real drag-and-drop. Wire the drop
  handler to the tested `computeFolderMove` so only the gesture, not the move math, is
  unverified by tests.

**Verification gate:** frontend `tsc -b` clean + `npm run build` OK + full Vitest suite green;
backend full test suite green; then an **in-browser human walkthrough**: rename a folder;
drag to reorder siblings; drag to re-nest under another folder; attempt an illegal drop
(onto own child — should no-op); collapse/expand; delete a folder with subfolders and confirm
the files survive in All Files; confirm COLLECTIONS rows are non-editable.

---

## Out of Scope / Deferred

- Keyboard- and screen-reader-accessible move ("Move to…" menu, ARIA) → refinements #6.
- Folder cover images and per-folder description editing → refinements #5.
- Descendant-inclusive file counts (Sidebar count stays direct-only).
- Persisting collapse/expand state across sessions.
- The dedicated full-screen Screen 6a layout and its right-panel folder detail editor.
