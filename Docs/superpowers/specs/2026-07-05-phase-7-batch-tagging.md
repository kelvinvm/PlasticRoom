# Phase 7 — Batch Tagging (Screen 4a) — Design Spec

**Goal:** Select multiple files in the library grid and add folder assignments and/or
tags to all of them at once, via a batch action panel that replaces the single-file
detail panel while 2+ files are selected.

**Status:** Not started (spec)
**Overview reference:** `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` (Phase 7 / Screen 4a)

---

## Scope & Decisions

- **Add-only semantics.** "Apply to N" ADDS the staged folders/tags to each selected
  file; every file keeps its existing other assignments, and nothing is ever removed.
  Removal / replace are out of scope for this phase.
- **New atomic batch endpoint.** Unlike Phases 4/6 (frontend-only), this phase adds ONE
  backend endpoint, `POST /api/files/batch/assign`, so the whole apply is transactional
  and one round-trip rather than up to 2N per-file calls. Add-only, de-duplicating.
- **Both folders and tags.** The batch panel stages folders AND tags. (Folders including
  system collections — they are ordinary `Folder` rows, same as Phase 6.)
- **Existing items only.** The panel searches/filters existing folders and tags to stage.
  Creating new folders (Phase 6 modal) or tags (import flow) happens elsewhere; no inline
  create in this phase.
- **Standard file-manager selection.** Plain click selects one (collapsing the selection);
  Ctrl/Cmd-click toggles one; Shift-click selects a range from the last-clicked anchor over
  the current visible grid order; Esc or a click on empty grid space clears. Double-click
  still opens the detail view.
- **Right panel is selection-size-driven.** 0 selected → existing "Select a file" empty
  state; exactly 1 → existing `FileDetailPanel` (unchanged); 2+ → new `BatchAssignPanel`.
- **Post-apply keeps the selection.** On success the staged pills clear and a brief inline
  confirmation shows, but the selection and multi-select mode persist so another round can
  be staged. The grid refreshes via the existing `useFiles().reload()`.

---

## Architecture

### Backend — `POST /api/files/batch/assign`

New action on `FilesController`.

- **Request:** `BatchAssignRequest(List<int> FileIds, List<int> AddFolderIds, List<int> AddTagIds)`.
- **Behavior (add-only, atomic):**
  1. Open a session and `BeginTransaction()`.
  2. Resolve and validate all ids up front: every `FileId`, `AddFolderId`, `AddTagId`
     must exist. Any missing id → the whole batch fails (see error handling) and nothing
     is persisted.
  3. For each file: for each requested folder id not already linked, create a
     `FileFolder`; for each requested tag id not already linked, create a `FileTag`.
     Existing links are skipped (idempotent add). No deletions → no `PurgeDeletedObjects()`.
  4. `CommitTransaction()`.
- **Response:** `200 OK` with the updated `ModelFileDto[]` for the affected files
  (same DTO shape returned by `SetFolders`/`SetTags`).
- **Empty inputs:** if both `AddFolderIds` and `AddTagIds` are empty → `400` (the client
  disables Apply in this state, so this is a guard, not a normal path).

This follows the established XPO session rules (see project memory): explicit
`BeginTransaction()`/`CommitTransaction()` because we persist across many objects
atomically; add-only means no `Delete()`/`PurgeDeletedObjects()` needed.

### Frontend

- **`api/client.ts`** — new `batchAssign(fileIds, addFolderIds, addTagIds): Promise<ModelFile[]>`
  → `POST /api/files/batch/assign`.
- **Selection state in `LibraryView`** — replace `selectedFileId: number | null` with:
  - `selectedFileIds: Set<number>`
  - `anchorId: number | null` (for shift-range)
  - a pure reducer, `lib/gridSelection.ts`, computing the next selection from
    `(current, files, clickedId, { metaKey, ctrlKey, shiftKey })` — unit-testable,
    UI-free. Plain → `{clicked}`; toggle (meta/ctrl) → add/remove; shift → inclusive range
    between anchor and clicked over the `files` order.
- **`FileGrid` / `FileCard`** — `onSelectFile(id, modifiers)` now carries the click
  modifiers; card renders selected (ring + top-left checkmark badge) and, when a
  multi-selection is active, dims unselected cards to 50%. A click on empty grid area and
  an `Escape` key handler clear the selection.
- **`LibraryToolbar`** — when 2+ selected, show "{n} files selected of {total}"; otherwise
  the existing folder/search title.
- **`components/BatchAssignPanel.tsx`** (+ `.module.css`, `.test.tsx`) — the new right
  panel. Props: `{ selectedFileIds: number[]; folders: Folder[]; tags: Tag[];
  onApplied: () => void }`. Local state: staged folder-id set, staged tag-id set, two
  search strings, `busy`, `error`, transient `confirmation`. Renders header
  "N files selected", a Folders search + filtered checkable results + staged pills, a Tags
  search + filtered results + staged pills, and "Apply to N" (disabled unless something is
  staged). On apply → `batchAssign(...)`; success clears staged sets, sets a brief
  confirmation, and calls `onApplied()` (which triggers `reloadFiles()` in `LibraryView`);
  failure sets a `role="alert"` message and keeps the staged sets.

### Data flow

```
click card (+modifiers) ─► gridSelection reducer ─► LibraryView.selectedFileIds
        │                                                    │
   FileGrid dims/rings                          size 0 → empty · 1 → FileDetailPanel
                                                          2+ → BatchAssignPanel
                                                                   │
                                          stage folders/tags ─► Apply to N
                                                                   │
                                 POST /api/files/batch/assign (atomic add) ─► updated DTOs
                                                                   │
                                        onApplied() ─► reloadFiles(); selection kept
```

---

## Components / Units

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `FilesController.BatchAssign` | Atomic add-only assignment across N files | XPO session, `ModelFile`/`Folder`/`Tag`, `ToDto` |
| `BatchAssignRequest` | Request record | — |
| `client.batchAssign` | Client fn for the endpoint | `parseJsonOrThrow`, `ModelFile` |
| `lib/gridSelection` | Pure selection reducer (plain/toggle/range/clear) | `ModelFile[]` |
| `BatchAssignPanel` | Stage folders+tags, apply, confirm/error | `batchAssign`, `Folder`/`Tag`, `ModelFile` |
| `FileGrid`/`FileCard` | Multi-select visuals + modifier-aware clicks | `gridSelection` (via `LibraryView`) |
| `LibraryToolbar` | "{n} of {total}" count when multi-selecting | — |
| `LibraryView` | Owns selection state, wires panel + reload | `useFiles`, `useFolders`, `useTags` |

---

## Error Handling

- **Atomic failure:** a missing file/folder/tag id, or any persistence error, rolls back
  the transaction — no partial writes. Endpoint returns `404` (unknown id) or `400`
  (empty inputs) / `500` (unexpected). The panel shows a `role="alert"` message and keeps
  the staged pills so the user can retry.
- **Client-side guard:** Apply is disabled until at least one folder or tag is staged.
- **Selection edge cases:** shift-click with no prior anchor behaves as a plain click;
  a range whose endpoints span filtered-out files uses only the currently visible order.

---

## Testing

- **Backend (xUnit):** add-only creates missing links and de-dupes existing ones; multiple
  files in one call; unknown file/folder/tag id → rollback (no links written) + correct
  status; response returns updated DTOs; empty inputs → 400.
- **Frontend (Vitest + RTL):**
  - `gridSelection` reducer: plain select, ctrl/meta toggle, shift range (incl. anchor
    reset), clear.
  - `BatchAssignPanel`: stage/unstage folder + tag pills; Apply disabled when nothing
    staged; success path calls `batchAssign` with the right ids, clears staged, shows
    confirmation, fires `onApplied`; failure shows alert and keeps staged.
  - `client.batchAssign`: POSTs the correct URL + JSON body.
  - `FileGrid`/`LibraryView`: modifier-click updates selection; 2+ selected swaps in the
    batch panel and shows the toolbar count; Esc clears.

---

## Out of Scope / Deferred

- Removing or replacing assignments in batch (add-only this phase).
- Inline folder/tag creation in the batch panel.
- Inline tag-color editing.
- A "what these files currently share" summary in the panel.
- Select-all / keyboard-driven grid navigation beyond Esc-to-clear.
- Folder-cycle guard in `FoldersController.Update` (still Phase 8).
