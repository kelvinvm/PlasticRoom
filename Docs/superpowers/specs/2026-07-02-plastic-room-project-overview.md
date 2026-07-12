# PlasticRoom — Project Reference

**Last updated:** 2026-07-12
**Status:** All 8 build phases complete and merged to `main` (2026-07-12), pushed to `github.com/kelvinvm/PlasticRoom`. This file is retained as the **architecture + design-token reference**; the per-phase spec/plan files in this folder capture implementation history, and `Docs/future-refinements.md` tracks the remaining (unscheduled) backlog.
**Design reference:** `Docs/design_handoff_3d_print_organizer/README.md` + `design_reference.dc.html`

---

## What We're Building

A web app for organizing 3MF/STL 3D-printer files — think Lightroom Classic, but for print files instead of photos. Core capabilities:

- Browse a library of files with embedded 3D previews
- Organize files into unlimited-depth nested folders (a file can belong to **many** folders simultaneously via many-to-many join)
- View a single file in detail with an embedded interactive 3D viewer
- Import new files with automatic metadata parsing (dimensions, print time, plate count)
- Batch-tag and batch-assign multiple files at once
- Manage the folder tree itself (create, rename, re-nest, reorder, delete)

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
- **No UI component library** — custom CSS modules using the design tokens below (also mirrored in `frontend/src/styles/tokens.css`)
- **Three.js + OrbitControls** for the embedded 3D viewer (Screen 2) and client-side thumbnail generation (import flow)
- Styling: IBM Plex Sans + IBM Plex Mono loaded from Google Fonts

### Backend
- **ASP.NET Core 10 Web API** (C#) — note: .NET 10, not the originally-specced .NET 8 (dev machine only has the .NET 10 SDK)
- **DevExpress XPO** ORM (nuget.org, 24.1.6) with **SQLite** data provider
- File parsing in C# (3MF = ZIP + XML; STL = binary header — no external library needed)
- REST API; frontend communicates exclusively via fetch

### Thumbnail Generation — Approach A (Client-side)
The frontend uses Three.js (already loaded for the 3D viewer) to parse and render each imported model in a hidden `<canvas>`, then POSTs the resulting PNG blob to the backend for storage. This keeps the Docker image lean (no headless Chromium) and reuses code already present for the viewer.

### Data Model
Design-time schema:
```
Folder        { Id, Name, ParentId, Description, CoverImageFileId, SortOrder }
File          { Id, Name, Type (3mf|stl), SizeBytes, AddedAt, Dimensions,
                EstPrintTimeMin, Material, LayerHeightMm, PlateCount,
                Description, ThumbnailPath }
FileFolder    { FileId, FolderId }           -- many-to-many
Tag           { Id, Name, ColorKey }
FileTag       { FileId, TagId }              -- many-to-many
```

**As built (via XPO):**
- The `File` entity is named **`ModelFile`** in code, to avoid colliding with `System.IO.File` used for disk I/O.
- **Collections** (Favorites, Printed, To Print, Failed Prints) are plain `Folder` rows with an **`IsSystem`** boolean — no separate type/discriminator. They nest and behave like any folder; the API only blocks rename/reparent/delete on them. The LIBRARY-vs-COLLECTIONS sidebar split is purely a frontend rendering choice on `IsSystem`.
- `Folder` exposes a computed **`FileCount`** (direct membership, not descendant-inclusive); `ModelFile` also carries **`SourceUrl`** + **`Creator`**.
- Bambu Studio 3MF import adds a **`Plate`** entity (`File`, `Index`, `Name`, `ThumbnailPath`, `BuildItemIndices`) for real per-slicer-plate grouping; non-Bambu files fall back to one plate per 3MF build item.

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

**Screen 6a note:** folder management was implemented as **inline editing in the existing library Sidebar** (rename, drag reorder/re-nest/un-nest, delete-with-confirm, chevrons, file counts), intentionally diverging from the dedicated Screen 6a layout. Cover images, per-folder description editing, and keyboard-accessible move were deferred — see `Docs/future-refinements.md`.

---

## Design Tokens (canonical reference)

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

## Resolved Design Decisions & Open Questions

- **Collections type** — a single `Folder` entity with an `IsSystem` boolean; no discriminator and no separate `Collection` entity. Collections nest and behave identically to any other folder except the API blocks rename/reparent/delete on them.
- **Folder filtering** — descendant-inclusive: a selected folder shows its files plus all files in nested subfolders (distinct union), implemented server-side on `GET /api/files?folderId=`.
- **Empty/loading states** — not formally designed. Follow the existing visual language (dark surfaces, orange accent, IBM Plex Mono for status text) when encountered.
- **Authentication** — out of scope. Single-user / local-only assumed; no auth.

---

## Running the App

- **Full app (Docker):** `docker-compose up --build` → http://localhost:3000. Does NOT seed sample data.
- **Dev:** backend `cd backend; dotnet run --project PlasticRoom.Api` (listens on http://localhost:5102); frontend `cd frontend; npm run dev` (http://localhost:5173, proxies `/api`). Prepend `$env:SEED_SAMPLE_DATA="true"` to the backend command to populate example content on a fresh DB.
- Per-phase specs and plans in this folder (`2026-07-*-phase-*.md`) document how each slice was built; `Docs/future-refinements.md` lists remaining backlog.
