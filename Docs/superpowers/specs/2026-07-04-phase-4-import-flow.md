# Phase 4 — Import Flow (Screen 5a)

**Date:** 2026-07-04
**Status:** Design approved; implementation not started
**Design reference:** `Docs/design_handoff_3d_print_organizer/screenshots/5a-import-flow.png`
**Project overview:** `2026-07-02-plastic-room-project-overview.md` (Phase 4 deliverables)

---

## Goal

Let the user drag in real `.3mf`/`.stl` files, see each one validated and previewed with
parsed metadata, assign folders + tags to the whole batch, and commit the import to the API.
This is the first phase that produces real thumbnails (client-side, via Three.js — "Approach A"
from the project overview).

---

## Scope

**In scope:**
- Drag-and-drop zone + click-to-browse (native multi-file picker), accepting `.3mf`/`.stl`.
- Client-side Three.js geometry load per file: validates the file is renderable and produces
  a PNG thumbnail from an offscreen canvas.
- Full-screen staging view: per-file row with thumbnail preview, name, preview metadata line,
  and status badge (`parsing → ready` / `parse-error`).
- Right "assign to all" panel: folder assignment (existing folders, search-select) and tags
  (search existing **or create inline**), applied to every imported file.
- Sequential commit with per-file progress and partial-failure recovery ("Retry N failed").

**Out of scope (deferred — listed so they do not creep in):**
- Displaying generated thumbnails in the library grid. No thumbnail-serving endpoint exists yet;
  the grid keeps its stripe placeholder. Serving + wiring is a later concern.
- Per-file metadata **editing** during import (name, description, etc.).
- Print time / material / layer height — manual-entry only (Phase 2 decision); not part of import.
- Per-file (as opposed to "for all") folder/tag assignment — that is Phase 7 (Batch Tagging).
- Duplicate detection.
- Choosing/editing tag colors (no tag-color UI exists anywhere yet).

---

## Key Decisions

### D1 — Staging metadata: client preview, server authoritative
The per-file metadata shown **before** commit is derived client-side, for free, from the same
Three.js geometry load that produces the thumbnail:
- **Size** — from the File API (`file.size`).
- **Dimensions** — from the Three.js geometry bounding box (mm).
- **Plate count** — read client-side for `.3mf` only; `null` for `.stl`.
- **No print time** in staging. The mock shows "18m print" on STL files, which is impossible —
  an STL carries no slicer metadata, and print time is manual-only. Showing it pre-import would
  be dishonest, so it is omitted. Staging line renders `dimensions · size` (+ `· N plates` for 3MF).

On commit, the backend's C# parsers re-derive dimensions/plates/size and store **those** values.
The client preview is preview-quality only; the server remains the single source of truth.
No new backend endpoint; the file is uploaded exactly once.

The parse status (`✓ parsed` / `✕ error`) therefore maps precisely to "did Three.js successfully
load this geometry" — which is the one thing that must succeed before a file can be imported. The
mock's error text ("Couldn't parse geometry — file may be corrupt") describes exactly this
client-side load failure.

### D2 — App entry point: view-state toggle, no router
`App.tsx` becomes a thin shell holding `view: 'library' | 'import'`. The existing three-pane body
is extracted into `views/LibraryView.tsx` (behavior unchanged). An **Import** button (in the
sidebar header) switches to the full-screen import view; **Cancel** or a fully-successful import
switches back and refetches folders + files.

- No `react-router`: routing two screens is not worth a dependency, and this matches the
  established no-router precedent (Phase 3). Navigation flows through explicit `onNavigate`
  callbacks, so promoting to a router later is a localized change in `App.tsx` and the call sites
  (swap the `useState` switch for `<Routes>`, swap callbacks for `useNavigate()`).
- Not a modal: Screen 5a is a full-screen takeover, not an overlay.

### D3 — Tags: inline creation with auto-assigned color; folders existing-only
- **Folders** ("ADD ALL TO FOLDER"): search-select over existing folders only. A folder can't be
  meaningfully auto-created mid-import (it needs a parent, position, etc. — Phase 8's job).
- **Tags** ("TAGS FOR ALL"): search existing; if the typed text matches none, offer
  **"Create '{name}'"**. New tags are created via `POST /api/tags` with a **color auto-assigned**
  from the palette (no color picker in Phase 4). Rationale: on a fresh library there are zero tags,
  so an existing-only field would be dead exactly when tagging is most useful.
- **Trade-off (accepted):** inline-created tags `POST` immediately (not deferred to commit), so the
  code path is identical to selecting an existing tag. If the user then cancels the import, the new
  tag persists as an orphan (no files). It is invisible in the current UI and harmless; a later
  tag-management phase can prune. This was judged cleaner than commit-time pending-tag bookkeeping.

### D4 — Commit: sequential, partial success, retry
- Commit runs **sequentially**, one file at a time, with a live per-row status
  (`queued → importing → imported` / `import-error`). Not parallel: the backend opens a fresh
  XPO/SQLite session per request, and concurrent writers on one SQLite file invite
  "database is locked" contention. Batch sizes are small (a person dragging files in), so speed is
  not the constraint.
- **Partial success is valid — no batch rollback.** A failed file marks only its own row; already
  imported files stay imported.
- **Two calls per file, different severity:** `POST /api/files` (create) is **fatal** for that row;
  `POST /api/files/{id}/thumbnail` is **non-fatal** (the file is imported regardless — the grid
  shows the placeholder anyway).
- **After the run:** imported rows collapse to a disabled `✓ imported`; failed rows remain and the
  button becomes **"Retry N failed"** (re-commits only those). If everything succeeded, navigate
  back to the library and refetch folders + files. The drop zone + Import button are disabled while
  a commit is in flight.

---

## Architecture

### Frontend units

| Unit | Responsibility |
|---|---|
| `App.tsx` | Thin shell: holds `view` state, renders `LibraryView` or `ImportView`, passes `onNavigate` |
| `views/LibraryView.tsx` | Extracted existing three-pane library (unchanged behavior) |
| `views/ImportView.tsx` | Full-screen import layout: header, drop zone, staging list, assign panel, footer |
| `components/import/DropZone.tsx` | Drag-and-drop + hidden `<input type=file multiple accept=".3mf,.stl">`; emits accepted `File[]` |
| `components/import/StagingRow.tsx` | One row: thumbnail preview, name, metadata line, status badge |
| `components/import/ImportAssignPanel.tsx` | Folder search-select + pills; tag search/create + pills; warning line; Import button |
| `lib/thumbnail.ts` | Isolation seam: `generateThumbnail(file) → { pngBlob, dims, plateCount }` |
| `hooks/useImportStaging.ts` | Staging state machine + commit orchestration |
| `api/client.ts` / `api/types.ts` | New: `uploadFile()`, `uploadThumbnail()`, `createTag()` + request/response types |

`lib/thumbnail.ts` is a deliberate boundary: WebGL/canvas cannot run in jsdom, so the generator is
injected into `useImportStaging` and replaced with a fake in tests; the real render is verified by
running the app.

### `lib/thumbnail.ts` (real implementation, verified by running)
- Load `.stl` via `STLLoader`, `.3mf` via `3MFLoader` (`three/examples/jsm/loaders/`).
- Render into an offscreen `<canvas>` (e.g. 256–512 px square): frame the geometry bounding box
  with a neutral camera + basic light/material, render once, `canvas.toBlob('image/png')`.
- Return `{ pngBlob, dims: {x,y,z} from bounding box, plateCount (3MF only, else null) }`.
- Throw on load failure → surfaced as `parse-error`.

### State model
```ts
type StagingStatus =
  | 'parsing' | 'ready' | 'parse-error'
  | 'importing' | 'imported' | 'import-error'

interface StagingItem {
  id: string                                  // client uuid
  file: File
  status: StagingStatus
  error?: string
  sizeBytes: number
  dims?: { x: number; y: number; z: number }  // Three.js bbox
  plateCount?: number | null                  // 3MF only
  thumbnailUrl?: string                        // object URL for preview
  thumbnailBlob?: Blob                         // POSTed on commit
}
```
Hook-level "for all" state: `selectedFolderIds: number[]`, `selectedTagIds: number[]`.

### Data flow
```
Drop/browse → each File becomes StagingItem (parsing)
  → generateThumbnail(file)
      ✓ → ready         (thumbnail + dims + plateCount cached)
      ✗ → parse-error   ("Couldn't parse geometry — file may be corrupt")
User sets "for all" folders + tags (inline-created tags POST /api/tags immediately)
Click "Import M files"  (M = ready count; button disabled when M = 0)
  → sequential loop over ready items:
      importing
      POST /api/files (multipart: file + folderIds + tagIds)   [fatal]
      POST /api/files/{id}/thumbnail (pngBlob)                 [non-fatal]
      → imported | import-error (loop continues)
  → all imported? → navigate to library, refetch folders + files
  → any failed?  → "Retry N failed" re-commits only failed rows
```

### Header + panel copy
- Header: `Import files · {N} detected · {M} ready` (N = total added incl. errors, M = ready).
- Panel warning when `M < N`: `"{N-M} file(s) couldn't be parsed — import the other {M}."`
- Import button label: `Import {M} files`.

---

## Backend

**Expected change: none for the happy path.** These endpoints already exist and do what's needed:
- `POST /api/files` — multipart upload; server-parses dims/plates/size; accepts `FolderIds`,
  `TagIds`, `SourceUrl`, `Creator`; returns the created `ModelFile` DTO.
- `POST /api/files/{id}/thumbnail` — stores PNG (form field named `file`).
- `POST /api/tags` — create tag (name + optional colorKey).
- `GET /api/folders`, `GET /api/tags`.

**To verify during implementation:** that `UploadFileRequest` binds `FolderIds`/`TagIds` arrays
from a **multipart** form (array binding in multipart can be finicky). If it does not bind cleanly,
the fix is a small `[FromForm]`/DTO adjustment — no new endpoints.

---

## Dependencies

Add **`three`** + **`@types/three`**. `3MFLoader` pulls in **`fflate`** for unzip — add it if not
present transitively. This is the first significant frontend bundle weight; acceptable, and the same
Three.js is reused by Phase 5's file-detail viewer.

---

## Error Handling

- **Unsupported type** (dropped non-`.3mf/.stl`): shown as a `parse-error` row
  ("Unsupported file type"), not silently dropped.
- **Geometry load failure:** `parse-error`, excluded from the ready count.
- **Commit — file create fails:** `import-error` on that row; loop continues; prior imports stay.
- **Commit — thumbnail fails:** non-fatal; file counts as imported.
- **During commit:** drop zone + Import button disabled.

---

## Testing

- `hooks/useImportStaging.ts` — state machine with a **fake thumbnail generator + mocked api**:
  parse success/failure, ready-count, sequential commit order, partial failure, retry-only-failed,
  folder/tag selection.
- `api/client.ts` — new functions with mocked `fetch`: correct `FormData` field names, error throwing.
- `DropZone` / `StagingRow` / `ImportAssignPanel` — RTL: drag + input events, each status rendering,
  tag search/select/create.
- `App` / `LibraryView` — extraction leaves existing tests green; add a view-toggle test.
- `lib/thumbnail.ts` real render — verified by **running the app** (`/run`), not in jsdom.

---

## Success Criteria

1. Dragging (or browsing) real `.3mf`/`.stl` files produces staging rows with a rendered thumbnail
   preview and `dimensions · size` metadata; unrenderable files show a red parse error and are
   excluded from the ready count.
2. Folder(s) and tag(s) — including a newly created tag — can be assigned to the whole batch.
3. "Import M files" commits every ready file (file + thumbnail + folders + tags); the new files
   appear in the library on return, in the assigned folder(s).
4. A mid-batch failure leaves already-imported files intact and offers "Retry N failed".
5. Existing Phase 1–3 tests remain green; new units are covered per the testing section.
