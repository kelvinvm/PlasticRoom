# Phase 5 — File Detail View (Screen 2a)

**Date:** 2026-07-04
**Status:** Design approved, ready for planning
**Design reference:** `Docs/design_handoff_3d_print_organizer/README.md` §2 + `screenshots/2a-file-detail-view.png`
**Project overview:** `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` (Phase 5)

---

## Goal

Double-clicking a file card opens a full-screen focus view for one model: a live, interactive
Three.js viewer (orbit/zoom, Solid/Wireframe/Plates render modes, a plate filmstrip for
multi-plate 3MF) alongside a metadata panel with an editable description and its folder/tag chips.

This phase also delivers the two file-serving endpoints the app has lacked since Phase 2 —
one to stream the original model bytes (required for the viewer) and one to stream the stored
thumbnail PNG — and wires **real thumbnails** into the library grid and detail panels, retiring
the stripe placeholder everywhere a real thumbnail exists.

---

## Key decisions (made during brainstorming)

1. **Entry / exit.** A file card opens the detail view on **double-click**; single-click keeps its
   existing behavior (select the card, fill the library's right detail panel). The breadcrumb
   provides back navigation.
2. **Scope includes thumbnails.** Phase 5 adds **two** GET endpoints — raw model content *and*
   thumbnail PNG — and displays real thumbnails in the library grid, the library right panel, and
   the detail-view filmstrip. The stripe placeholder becomes a fallback only.
3. **A "plate" is a 3MF `<build><item>`.** This matches the backend's existing definition —
   `ThreeMfMetadataParser` sets `PlateCount` to the count of `<item>` elements
   (`ThreeMfMetadataParser.cs:46`). The filmstrip therefore shows exactly `plateCount` entries and
   never disagrees with the SPECS panel. STL files and single-item 3MF (`objects.length <= 1`) hide
   the filmstrip. **Caveat, accepted:** a build-item is not semantically a physical print plate (a
   slicer plate can hold many objects); true slicer-plate grouping lives in proprietary metadata we
   do not parse. Being consistent with our own `plateCount` is the right call for this phase.
4. **Breadcrumb path = the folder you came from.** Because a file can belong to many folders, the
   breadcrumb uses the library's active-folder context at the moment of navigation (`fromFolderId`).
   When opened from the unfiltered/all-files view, it falls back to `Library › {filename}`.
5. **Right panel.** SPECS rows are read-only. The DESCRIPTION block is editable and **auto-saves on
   blur** (with a short debounce) via the existing `PUT /api/files/{id}`. Folder/tag chips are real
   and read-only. The "+add" pill is present but **deferred to Phase 6** (it owns the multi-assign
   modal); in Phase 5 it is a visible placeholder that does not open anything.
6. **Shared model-loading core.** The STL/3MF loading logic in `frontend/src/lib/thumbnail.ts`
   (Phase 4) is extracted into `frontend/src/lib/modelLoading.ts`; both the offscreen thumbnail
   renderer and the new live viewer import it, so a thumbnail and the live viewer always interpret
   the same file identically (same world-space framing fix, same object list).

---

## Backend

Two new endpoints on `FilesController`. Both are thin `PhysicalFile` reads using data already
persisted on `ModelFile` (`StoragePath`, `ThumbnailPath`). No entity or schema changes.

### `GET /api/files/{id}/content`
- Loads the `ModelFile`; `404` if the record is missing or `StoragePath` does not exist on disk.
- Returns `PhysicalFile(StoragePath, contentType, downloadName: Name, enableRangeProcessing: true)`.
- `contentType`: `model/3mf` for 3MF, `model/stl` for STL (exact value is not critical — the client
  reads the body as an `ArrayBuffer`; range processing is the point, to stream large files).

### `GET /api/files/{id}/thumbnail`
- Loads the `ModelFile`; `404` if the record is missing, `ThumbnailPath` is null, or the PNG is
  gone from disk.
- Returns `PhysicalFile(ThumbnailPath, "image/png")`.
- The frontend treats any non-200 as "use the stripe placeholder."

`PUT /api/files/{id}` already persists `Description` (used by the auto-save) — no change needed.

---

## Frontend

### App shell & navigation
`App.tsx` currently switches `view: 'library' | 'import'`. It gains detail context — e.g. a
discriminated union or a `detailTarget: { fileId, fromFolderId } | null` alongside `view`.

**The library view stays mounted** while the detail view is shown; detail renders as a full-screen
layer on top. This preserves the library's active folder, scroll position, and selection so
breadcrumb "back" returns to the exact same place instantly (the core double-click → back loop).
Import remains a plain `view` swap as today.

`LibraryView` exposes `onOpenFile(fileId)`, fired on file-card **double-click**, passing its current
`activeFolderId` as `fromFolderId`.

### New / changed modules
- **`lib/modelLoading.ts`** — extracted from `thumbnail.ts`. Signature roughly
  `loadModel(bytes: ArrayBuffer, type: '3mf' | 'stl'): { object: THREE.Object3D, bounds: THREE.Box3, objects: THREE.Object3D[] }`,
  where `objects` are the top-level build-items (the "plates") and `bounds` is the world-space
  bounding box (the Phase 4 3MF framing fix). `thumbnail.ts` is refactored to call it; its existing
  tests must stay green.
- **`lib/viewerModes.ts`** — pure, WebGL-free scene-graph helpers, unit-testable without a GPU:
  - `applyRenderMode(objects, mode)` — `mode: 'solid' | 'wireframe' | 'plates'`; toggles
    `material.wireframe`, applies per-build-item tint in `plates` mode, restores default material
    otherwise.
  - `setActivePlate(objects, index | null)` — isolates one build-item (others hidden/dimmed);
    `null` shows all.
- **`api/client.ts`** — add `getFile(id)`, `fileContentUrl(id)`, `fileThumbnailUrl(id)`,
  `updateFileDescription(id, description)` (or reuse the existing update method). Add matching
  camelCase types in `api/types.ts` if the single-file DTO differs from the list DTO.
- **`hooks/useFile.ts`** — fetches one file's full detail (metadata + folders + tags) from
  `GET /api/files/{id}`.

### New components
- **`views/DetailView.tsx`** — top level: breadcrumb bar, left viewer column, right panel. Owns
  `useFile(id)` and the `/content` bytes fetch; passes loaded `objects`/`bounds` down. Renders
  loading and error states for the viewer area.
- **`components/viewer/ModelViewer.tsx`** — the Three.js canvas: scene, lights, camera framed by
  world-space `bounds`, `OrbitControls` (drag to orbit, scroll to zoom), resize handling, full
  disposal on unmount. Thin — delegates all render-mode / plate changes to `lib/viewerModes.ts`.
- **`components/viewer/ViewerModeToggle.tsx`** — Solid / Wireframe / Plates segmented control;
  active segment `--accent` bg with dark text, inactive bordered surface.
- **`components/viewer/PlateFilmstrip.tsx`** — 96px-tall strip of per-build-item thumbnails,
  generated client-side from each `object` via the shared renderer. Hidden when
  `objects.length <= 1`. Clicking a plate isolates it (`setActivePlate`); the active plate gets the
  orange ring; an "All" affordance (or re-clicking the active plate) restores the full model.
- **`components/detail/DetailInfoPanel.tsx`** — right panel (320px, `--bg-panel`): file name
  (700/15px) + size·date; **SPECS** rows (Dimensions, Est. print time, Material, Layer height,
  Plates — mono, right-aligned); **DESCRIPTION** editable textarea (auto-save on blur → `PUT`, with
  a subtle saved indicator); **IN FOLDERS/COLLECTIONS** real chips + deferred "+add" placeholder.
- CSS Modules per component over `styles/tokens.css`, following the Phase 3/4 pattern.

### Real thumbnails (retire the placeholder)
- `FileGrid` card thumbnail and the library `FileDetailPanel` thumbnail render
  `<img src={fileThumbnailUrl(id)} onError={fallback}>`; on error (or no thumbnail) they fall back
  to the existing stripe-gradient placeholder. The 3MF/STL type-label overlay stays.
- The import flow (Screen 5a) keeps its client-side preview — unchanged.

---

## Render-mode & plate behavior

- **Solid** — all build-items, standard material.
- **Wireframe** — all build-items, wireframe on.
- **Plates** — all build-items, each tinted a distinct color: a "layout" overview showing how many
  plates/items the file contains and where they sit.
- **Filmstrip** (multi-item 3MF only) — clicking a plate **isolates** that single build-item in the
  viewer, independent of the current render mode; "All" (or re-clicking the active plate) restores.
  The count of filmstrip entries equals `plateCount` shown in SPECS.

Default render mode on open: **Solid**, showing all plates (no isolation).

---

## Data flow

1. Library card double-click → `App` records `detailTarget = { fileId, fromFolderId }` and shows the
   detail layer.
2. `DetailView` mounts → `useFile(fileId)` GETs metadata; a fetch to `/api/files/{id}/content`
   returns the bytes → `loadModel` → `{ object, bounds, objects }` → `ModelViewer`.
3. `PlateFilmstrip` renders per-`objects[i]` thumbnails via the shared renderer.
4. Description edit → on blur, `PUT /api/files/{id}` with the new description → refetch (or optimistic
   update).
5. Breadcrumb "back" → `App` clears `detailTarget` / hides the layer; the still-mounted library
   shows the same folder, scroll, and selection.

---

## Error & loading states

(The design flags these as gaps; resolved here, following the existing dark/orange/Plex-Mono
visual language.)

- **Viewer loading** — centered spinner + `Loading model…` (IBM Plex Mono) over the
  `radial-gradient(circle at 50% 40%, #241f1a, #131010)` viewer background.
- **Load / parse failure or `/content` 404** — an in-viewer error card: "Couldn't load this model"
  plus a short reason. The breadcrumb/back and the right-panel metadata remain fully functional.
- **Missing thumbnail (`/thumbnail` 404)** — stripe placeholder via `<img onError>`, everywhere a
  thumbnail is shown.

---

## Testing

### Backend (xunit — `FilesControllerTests`)
- `GET /content` returns the stored bytes for an existing file; `404` for an unknown id and for a
  record whose on-disk file is missing.
- `GET /thumbnail` returns the PNG (`image/png`) when `ThumbnailPath` is set; `404` when it is null
  or the file id is unknown.

### Frontend (vitest)
- `modelLoading` — object/plate extraction; existing `thumbnail.test.ts` stays green after the refactor.
- `viewerModes` — pure logic: wireframe flag per mode, per-plate tint in `plates` mode, isolate
  visibility from `setActivePlate`.
- `useFile` — fetch + shape.
- `ViewerModeToggle` — mode selection emits.
- `PlateFilmstrip` — hidden for STL/single-item; renders N entries for multi-item; active ring;
  click emits the plate index.
- `DetailInfoPanel` — SPECS render, description blur triggers `PUT`, deferred "+add" placeholder present.
- `FileGrid` / library `FileDetailPanel` — real-thumbnail `<img>` with stripe fallback on error.
- `ModelViewer` — carries the `// @vitest-environment jsdom` docblock (Phase 4 `three` quirk) and is
  tested at the wiring level (props → scene-graph calls), not by asserting rendered pixels.

---

## Out of scope / deferred

- **Multi-assign modal** ("+add" pill target) — Phase 6 (Screen 3a). Phase 5 shows the placeholder only.
- **Real slicer-plate grouping** (Bambu/Prusa proprietary metadata) — not parsed; "plate" stays a
  3MF build-item.
- **Batch/multi-select** interactions — Phase 7.
- **Folder-cycle guard** in `FoldersController.Update` — still deferred to Phase 8.
- `fflate` npm dep cleanup and moving `typeLabel` into `lib/format.ts` — minor, revisit in cleanup.
