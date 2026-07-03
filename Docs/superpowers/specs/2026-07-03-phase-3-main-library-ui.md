# Phase 3 — Main Library UI (Screen 1a)

**Date:** 2026-07-03
**Status:** Spec approved, implementation not started
**Parent:** [Project Overview](2026-07-02-plastic-room-project-overview.md)
**Design reference:** `Docs/design_handoff_3d_print_organizer/screenshots/1a-library-classic-three-pane.png` + design tokens in the project overview

---

## Goal

Turn the current health-check smoke screen into the real, functional home view: a three-pane library (folder/collections sidebar, file-card grid, file detail panel) rendering live API data, with folder navigation and search. Read-only — no editing, import, or multi-assign this phase.

## Design Decisions Made This Phase

- **Frontend approach: plain React.** Component-local `useState`/`useEffect` + `fetch` behind small custom hooks, styled with CSS Modules over a global design-token stylesheet. No UI component library, no data-fetching library (TanStack Query), no state manager (Zustand) — Phase 3 is read-only over three GET endpoints, so those earn nothing yet and would only bloat the Docker image. They can be reconsidered when mutations arrive (Phase 4+).
- **Folder filtering is descendant-inclusive.** Resolves the overview's open question. Selecting a folder shows files assigned to it *and* to any nested descendant folder (Lightroom-style), as a distinct union. Implemented server-side by extending `GET /api/files`.
- **Search is a server-side query param, combinable with the folder filter.** A new `q` param on `GET /api/files` does a case-insensitive substring match on file `Name` + `Description`. It combines with `folderId`: searching on "All Files" is global across the library; searching inside a selected folder is scoped to that folder's subtree. Search input is debounced client-side before refetch.
- **The right detail panel is read-only this phase.** It displays the selected file's thumbnail, metadata, folder chips, and tag chips. Editing (description textarea, add-folder/tag affordances) arrives in Phase 5.
- **Thumbnails render as the striped placeholder.** Real thumbnail bytes are generated client-side by the Phase 4 import flow, and no endpoint serves thumbnail images to the browser yet. Phase 3 uses the design's `repeating-linear-gradient` placeholder with a `"3MF PREVIEW"` / `"STL PREVIEW"` label for every card and the detail panel. Adding a thumbnail-serving endpoint is deferred.
- **System collections need no new work to appear.** `FolderSeeder` already idempotently seeds Favorites / Printed / To Print / Failed Prints on startup. The sidebar's COLLECTIONS section is a pure rendering split on `IsSystem` — no new endpoint or query param.

---

## Backend Slice

The only backend change is extending the existing `GET /api/files` endpoint. No new entities, no schema changes.

```
GET /api/files
    query: ?folderId= (optional, int)   ?q= (optional, string)

    folderId present  → the selected folder AND all its descendant folders
                        (recursive walk over Folder.Children), unioned and de-duplicated
                        by file Oid. 404 if folderId does not exist (unchanged).
    folderId absent   → all files (unchanged).

    q present         → case-insensitive substring match on File.Name OR File.Description
                        (null Description never matches). Applied AFTER folder scoping,
                        so folderId + q returns the subtree filtered by the term.
    q absent/empty    → no text filtering.

    → list of ModelFileDto (shape unchanged)
```

Implementation notes:
- Descendant collection: a recursive helper that, starting from the target folder, accumulates it plus every folder reachable through `Folder.Children`. Union the `FileFolders` of all collected folders and distinct-by file `Oid`. Guard against pathological cycles is unnecessary (the tree is acyclic by construction) but the walk should still visit each folder once.
- Text filter runs in memory over the already-materialized file list (case-insensitive `Contains`), consistent with the existing controller's materialize-then-project style. Trim `q`; treat empty/whitespace as absent.

### Sample-data seeder (dev only)

To make the UI viewable before the Phase 4 import flow exists, add a **dev-only** sample-content seeder, separate from the always-on `FolderSeeder`:

- Gated behind an environment flag (e.g. `SEED_SAMPLE_DATA=true`); does nothing unless set, so it never runs in production or in the test suite.
- Idempotent: no-op if sample content already present (detect by a marker, e.g. a known sample folder name, or "any non-system folder exists").
- Creates a few nested regular folders (e.g. `Miniatures > DnD Campaign`, `Household > Kitchen`, `Terrain`), a handful of tags with varied `ColorKey`s, and uploads a small set of bundled sample `.3mf`/`.stl` files (reuse the parser test fixtures), assigning them across folders, system collections, and tags so every sidebar section and card element has realistic content.
- Documented in the README: how to enable the flag and what it produces.

---

## Frontend Structure

Replaces the current inline-styled `App.tsx` smoke screen with the real application shell.

### Foundation
- `index.html`: load IBM Plex Sans + IBM Plex Mono from Google Fonts.
- A global token stylesheet (`tokens.css` / CSS custom properties) carrying the design tokens from the overview (colors, radii, spacing, the thumbnail placeholder gradient).
- Per-component CSS Modules; no inline styles for layout.

### Data layer
- `api.ts`: typed `fetch` wrappers — `getFolders()`, `getTags()`, `getFiles(folderId?, q?)`.
- `types.ts`: TS interfaces mirroring `FolderDto`, `TagDto`, `ModelFileDto`.
- `buildFolderTree(folders)`: flat list → nested tree by `parentId`, split-able into system vs non-system.
- Formatters: file size (bytes → human), dimensions (`X × Y × Z mm`), print time (minutes → `Nh Mm`).
- `tagColor(colorKey)`: maps a tag `ColorKey` to a display color (brass and the other token colors), with a sensible fallback.

### Hooks
- `useFolders()`, `useTags()`: fetch once on mount.
- `useFiles(folderId, q)`: refetch whenever `folderId` or (debounced) `q` changes; exposes `loading` / `error` / `data`.

### Components (each one clear purpose)
- `App` — three-pane layout shell; owns `selectedFolderId` (`null` = All Files), `selectedFileId`, `searchQuery`.
- `Sidebar`
  - `LibrarySection` — an "All Files" row (selects `null`) above a recursive `FolderTree` of non-system folders (14px indent per level; active row orange-tinted).
  - `CollectionsSection` — system folders (Favorites, Printed, To Print, Failed Prints).
- `LibraryToolbar` — current folder name, file count, and the search input.
- `FileGrid` → `FileCard` — 4-column grid; card = placeholder thumbnail, name, description, tag pills, selection ring when selected.
- `FileDetailPanel` — selected file's placeholder thumbnail, metadata rows, folder chips, tag chips (read-only). Empty state when nothing selected.

### Behavior
- Click a folder/collection → updates `selectedFolderId` → grid refetches (descendant-inclusive).
- Click a file card → updates `selectedFileId` → right panel shows that file.
- Type in search → debounced → refetch with `q` (combined with current `folderId`).
- Selecting a different folder clears the file selection if the selected file is no longer in view.

### States (match the visual language — IBM Plex Mono status text on dark surfaces)
- **Loading:** mono "Loading…" (or skeleton) in the grid while files fetch.
- **Empty folder:** centered mono message when a folder has no files.
- **No search results:** centered mono message distinguishing "no matches" from "empty folder".
- **Fetch error:** per-pane error message; the rest of the app stays usable.

---

## Not In Scope

- Editing anything — file metadata, descriptions, folder rename/reorder (Phases 5, 8).
- Import / drag-and-drop / client-side thumbnail generation (Phase 4).
- Folder/collection multi-assign and batch tagging (Phases 6, 7).
- Serving real thumbnail images to the browser (deferred; placeholders only).
- Multi-select in the grid (Phase 7).

---

## Success Criteria

- With sample data seeded, the home view renders all three panes populated from live API data on load.
- The sidebar shows non-system folders as a nested, indented tree under an "All Files" row, and the four system collections in a separate COLLECTIONS section.
- Selecting a parent folder shows files from that folder **and** its descendant subfolders; selecting "All Files" shows every file.
- Clicking a file card marks it selected (selection ring) and populates the right detail panel with that file's placeholder thumbnail, metadata, folder chips, and tag chips.
- Typing in search filters the grid server-side; on "All Files" it searches the whole library, inside a folder it searches that subtree; clearing it restores the folder view.
- Loading, empty-folder, no-results, and fetch-error states each render appropriately.
- `GET /api/files?folderId=X` returns the descendant-inclusive, de-duplicated file set; `?q=` filters case-insensitively on name/description; the two combine.

---

## Testing

### Backend (xUnit, existing temp-directory `XpoSessionFactory` pattern)
- Descendant-inclusive filtering: a file only in a grandchild folder appears when the grandparent is selected; a file in an unrelated folder does not.
- De-duplication: a file assigned to two folders in the same selected subtree appears once.
- Search: case-insensitive match on `Name` and on `Description`; non-matching term returns empty; null `Description` never matches.
- Combined `folderId` + `q`: term filtering is scoped to the subtree.
- Unchanged behaviors still hold: no `folderId` → all files; unknown `folderId` → 404.

### Frontend (Vitest + React Testing Library, mocked `fetch`)
- `buildFolderTree` and the formatters as pure-unit tests.
- Sidebar renders LIBRARY tree + COLLECTIONS; clicking a folder triggers a files fetch with the right `folderId`.
- Grid renders cards; clicking a card updates the detail panel content.
- Search input debounces and refetches with `q`.
- Loading, empty, no-results, and error states render as specified.
