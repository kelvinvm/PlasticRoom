# PlasticRoom — Project Overview

**Last updated:** 2026-07-02  
**Status:** Brainstorming complete, Phase 1 not yet started  
**Design reference:** `Docs/design_handoff_3d_print_organizer/README.md` + `design_reference.dc.html`

---

## What We're Building

A web app for organizing 3MF/STL 3D-printer files — think Lightroom Classic, but for print files instead of photos. Core capabilities:

- Browse a library of files with embedded 3D previews
- Organize files into unlimited-depth nested folders (a file can belong to **many** folders simultaneously via many-to-many join)
- View a single file in detail with an embedded interactive 3D viewer
- Import new files with automatic metadata parsing (dimensions, print time, plate count)
- Batch-tag and batch-assign multiple files at once
- Manage the folder tree itself (create, rename, re-nest, reorder, delete; per-folder description + cover image)

The design is high-fidelity and fully specified. See the design reference screenshots in `Docs/design_handoff_3d_print_organizer/screenshots/` and the HTML canvas at `Docs/design_handoff_3d_print_organizer/design_reference.dc.html`.

---

## Architecture Decisions

### Deployment
- **Docker container** via `docker-compose`
- Two containers: `frontend` (Nginx serving Vite build) + `backend` (ASP.NET Core runtime)
- Named Docker volume `plasticroom-data` mounted into the backend at `/data`:
  - `/data/plasticroom.db` — SQLite database
  - `/data/files/` — uploaded 3MF/STL originals
  - `/data/thumbs/` — generated thumbnail PNGs

### Frontend
- **React + TypeScript** (Vite)
- **No UI component library** — custom CSS modules using the design tokens from the spec
- **Three.js + OrbitControls** for the embedded 3D viewer (Screen 2) and client-side thumbnail generation (import flow)
- Styling: IBM Plex Sans + IBM Plex Mono loaded from Google Fonts

### Backend
- **ASP.NET Core 10 Web API** (C#)
- **DevExpress XPO** ORM with **SQLite** data provider
- File parsing in C# (3MF = ZIP + XML; STL = binary header — no external library needed)
- REST API; frontend communicates exclusively via fetch/axios

### Thumbnail Generation — Approach A (Client-side)
The frontend uses Three.js (already loaded for the 3D viewer) to parse and render each imported model in a hidden `<canvas>`, then POSTs the resulting PNG blob to the backend for storage. This keeps the Docker image lean (no headless Chromium) and reuses code already present for the viewer.

### Data Model (spec-defined, to be implemented via XPO)
```
Folder        { Id, Name, ParentId, Description, CoverImageFileId, SortOrder }
File          { Id, Name, Type (3mf|stl), SizeBytes, AddedAt, Dimensions,
                EstPrintTimeMin, Material, LayerHeightMm, PlateCount,
                Description, ThumbnailPath }
FileFolder    { FileId, FolderId }           -- many-to-many
Tag           { Id, Name, ColorKey }
FileTag       { FileId, TagId }              -- many-to-many
```

Collections (Favorites, Printed, To Print, Failed Prints) are modelled as special-cased Folders or a separate flat collection type — **to be decided in Phase 2**.

---

## Screens (from design spec)

| ID  | Screen                          | Key features |
|-----|---------------------------------|--------------|
| 1a  | Main Library (Classic 3-pane)   | Folder tree sidebar, 4-col file grid, right detail panel, search |
| 2a  | Single-file detail view         | Three.js viewer, Solid/Wireframe/Plates toggle, filmstrip for plates |
| 3a  | Folder/collection multi-assign  | Checkbox tree modal, diff-on-save |
| 4a  | Batch tagging                   | Multi-select grid, batch folder + tag assignment |
| 5a  | Import flow                     | Drag-and-drop, client-side parse + thumbnail, staging panel |
| 6a  | Folder management               | Drag-to-reorder/re-nest tree, per-folder detail editor |

---

## Build Phases

Each phase is a complete vertical slice (infrastructure → API → UI). Phases are designed to be independently completable across separate sessions.

### Phase 1 — Scaffolding & Docker
**Goal:** A working, containerized skeleton — both sides talking, nothing visible beyond a health check.

Deliverables:
- Repo structure: `frontend/` (Vite + React + TS), `backend/` (ASP.NET Core solution)
- `docker-compose.yml` wiring both containers + the `plasticroom-data` volume
- `Dockerfile` for each service
- XPO session factory wired up, connecting to `/data/plasticroom.db`
- `GET /api/health` endpoint returning `{ status: "ok" }`
- Frontend fetches health endpoint on load and displays the response (smoke test)

**Status:** Not started  
**Spec:** *(to be written when Phase 1 begins)*

---

### Phase 2 — Data Model & Core API
**Goal:** All XPO entities created, migrations run, CRUD endpoints for folders and files.

Deliverables:
- XPO entity classes: Folder, File, FileFolder, Tag, FileTag
- Decide: Collections as special Folders or separate type
- REST endpoints: list/create/update/delete for folders and files
- File upload endpoint: receives binary, writes to `/data/files/`, creates File record
- Basic 3MF/STL metadata parsing on upload (dimensions, plate count, file size)
- Thumbnail upload endpoint (receives PNG from client, writes to `/data/thumbs/`)

**Status:** Complete and merged to master (2026-07-03)
**Spec:** [Phase 2 — Data Model & Core API](2026-07-03-phase-2-data-model-core-api.md)
**Plan:** [Phase 2 implementation plan](../plans/2026-07-03-phase-2-data-model-core-api.md)

---

### Phase 3 — Main Library UI (Screen 1a)
**Goal:** The home view is fully functional with real API data.

Deliverables:
- Left sidebar: folder tree (nested, indented 14px/level) + collections list; active row orange-tinted
- Center: top toolbar (folder name, file count, search); 4-column file card grid
- File card: stripe placeholder thumbnail, file name, description, tag pills, selection ring
- Right sidebar: selected file detail panel (thumbnail, metadata rows, folder/tag chips)
- Navigation: click folder → filter grid; click file card → update right panel
- Search: filters visible cards client-side (or via API query param)

**Status:** Complete and merged to master (2026-07-03)
**Spec:** [Phase 3 — Main Library UI](2026-07-03-phase-3-main-library-ui.md)
**Plan:** [Phase 3 implementation plan](../plans/2026-07-03-phase-3-main-library-ui.md)

---

### Phase 4 — Import Flow (Screen 5a)
**Goal:** User can drag in real 3MF/STL files, see parsed metadata, and commit the import.

Deliverables:
- Drag-and-drop zone + click-to-browse (native file picker)
- Client-side Three.js model loading + hidden canvas render → PNG thumbnail
- Per-file parse status: `pending` → `✓ parsed` (green) or `✕ error` (red)
- Right panel: folder assignment + tags staged for all files; warning if some failed
- "Import N files" commits all parsed files to the API (upload file + thumbnail + metadata)
- Failed files excluded from commit count

**Status:** Complete and merged to master (2026-07-04)
**Spec:** [Phase 4 — Import Flow](2026-07-04-phase-4-import-flow.md)
**Plan:** [Phase 4 implementation plan](../plans/2026-07-04-phase-4-import-flow.md)

---

### Phase 5 — File Detail View (Screen 2a)
**Goal:** Clicking a file card opens a full-screen interactive 3D viewer.

Deliverables:
- Breadcrumb bar (folder path › file name) with back navigation
- Three.js scene: load model from `/data/files/`, OrbitControls (drag to orbit, scroll to zoom)
- Solid / Wireframe / Plates segmented toggle
- Filmstrip of plate thumbnails for multi-plate 3MF; hidden for STL files
- Right panel: metadata display, editable description textarea, folder/collection chips + add affordance

**Status:** Complete and merged to master (2026-07-04)  
**Spec:** [Phase 5 — File Detail View](2026-07-04-phase-5-file-detail-view.md)  
**Plan:** [Phase 5 implementation plan](../plans/2026-07-04-phase-5-file-detail-view.md)

---

### Phase 6 — Folder/Collection Multi-assign (Screen 3a)
**Goal:** A file can be assigned to any number of folders via a checkbox tree modal.

Deliverables:
- "+ add" pill (Screens 1 and 5) opens modal
- Modal: 760px wide, file thumbnail + title header, full checkbox folder tree
- Checked rows: solid orange checkbox + subtle orange row tint
- Expand/collapse chevrons for parent folders; 22px indent per depth level
- Working set of folder IDs diffed against current assignments on Save
- "+ New folder" link in modal footer

**Status:** Complete  
**Spec:** `Docs/superpowers/plans/2026-07-05-phase-6-folder-collection-multi-assign.md`

---

### Phase 7 — Batch Tagging (Screen 4a)
**Goal:** Select multiple files and apply folder assignments / tags to all of them at once.

Deliverables:
- Cmd/Ctrl-click or Shift-click in the library grid enters multi-select mode
- Selected cards: orange selection ring + checkmark badge (top-left); unselected dimmed to 50%
- Toolbar updates: "{n} files selected of {total}"
- Right panel becomes batch action panel: folder search + staged pills, tag search + staged pills
- "Apply to N" commits staged assignments/tags to all selected files via API

**Status:** Not started  
**Spec:** *(to be written when Phase 7 begins)*

---

### Phase 8 — Folder Management (Screen 6a)
**Goal:** Dedicated screen for editing the folder tree structure and per-folder metadata.

Deliverables:
- Left panel: full tree with drag handles (⠿), expand/collapse, file count per folder (IBM Plex Mono)
- Drag-to-reorder (sibling) and drag-to-re-nest (drop onto folder) with drop-target highlight
- Right-click context menu: rename, move, delete
- Right panel: selected folder detail — editable name, editable description, cover image picker
- Cover image: auto-suggested thumbnails from files in the folder; "+ Upload" tile
- Action row: Save changes (orange), Move to… (outlined), Delete folder (destructive red)

**Status:** Not started  
**Spec:** *(to be written when Phase 8 begins)*

---

## Design Tokens (from spec — canonical reference)

### Colors
```
--bg-app:        #0f0e0c
--bg-panel:      #151210
--bg-surface:    #1c1815   /* cards, inputs — also #1f1b17 / #17140f */
--border:        rgba(255,255,255,.08)
--text-primary:  #f2ede4
--text-secondary:rgba(242,237,228,.55)
--text-tertiary: rgba(242,237,228,.35)
--accent:        #ff8a3d
--accent-text:   #1a1512   /* text on orange bg */
--accent-tint:   rgba(255,138,61,.13)
--tag-brass:     #dbb55a
--tag-brass-tint:rgba(219,181,90,.15)
--success:       #3ddc97
--error:         #e0654a
```

### Typography
```
Font UI:    IBM Plex Sans (400/500/600/700)
Font Mono:  IBM Plex Mono (400/500/600)

26px  — page/screen title
18px  — section title
15px  — panel title
13px  — body / labels
11px  — secondary text
10px  — tag pills, mono readouts
```

### Spacing & Radius
```
Card radius:      9px
Pill radius:      99px
Button radius:    7px
Chip radius:      5px
Grid gap:         16px
Panel padding:    20px
Selection ring:   box-shadow: 0 0 0 2px #ff8a3d
```

### Thumbnail Placeholder
```css
background: repeating-linear-gradient(
  135deg,
  #241f1a, #241f1a 8px,
  #2b241e 8px, #2b241e 16px
);
```

---

## Open Questions (to resolve per phase)

- ~~**Collections type:** Should Favorites / Printed / To Print / Failed Prints be special-cased Folder rows (with a `type` discriminator) or a separate `Collection` entity?~~ **Resolved in Phase 2 spec:** no discriminator needed — a single `Folder` entity with an `IsSystem` boolean; collections nest and behave identically to any other folder except the API blocks rename/reparent/delete on them.
- ~~**Folder filtering:** When a folder is selected, does the grid show files assigned directly to it, or also files in any descendant folder? ("TBD — confirm with product" per spec.) Decide in Phase 3.~~ **Resolved in Phase 3 spec:** descendant-inclusive — a selected folder shows its files plus all files in nested subfolders (distinct union), implemented server-side on `GET /api/files?folderId=`.
- **Empty/loading states:** Not designed. Follow existing visual language (dark surfaces, orange accent, IBM Plex Mono for status text) when encountered during implementation.
- **Authentication:** Not specified. Single-user/local-only assumed; no auth in scope.

---

## Session Continuity Notes

When picking this up in a new session:
1. Read this file first for full context.
2. Check the phase status fields above to find where to resume.
3. Each phase will have its own detailed spec written before implementation starts (linked above when created).
4. Run `docker-compose up --build` to verify the current state of the app at any point after Phase 1.
