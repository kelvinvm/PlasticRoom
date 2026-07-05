# Bambu Plate Metadata Support

**Date:** 2026-07-04
**Status:** Design approved, ready for planning
**Type:** Enhancement (builds on Phase 5 — File Detail View, Screen 2a)
**Motivation:** Real-world verification with a Bambu Studio project (`BathroomShelf-5x13.3mf`) exposed that the "a plate = one 3MF `<build><item>`" approximation is wrong for slicer projects: that file has **21 build items but 7 actual print plates**, so the detail-view filmstrip showed 21 cells instead of the 7 plates the user sliced.

---

## Goal

Show **real print plates** in the file detail view for Bambu Studio 3MF projects: the correct plate count, each plate's slicer-authored name, the slicer's own embedded plate thumbnail, and click-to-isolate that groups all of a plate's objects. Non-Bambu 3MF and STL files keep the existing per-build-item behavior as a fallback.

Bambu 3MF files already embed everything needed — `Metadata/model_settings.config` maps objects to named plates and references embedded plate PNGs — so for these files we parse and reuse the slicer's data rather than approximating.

---

## Key decisions (from brainstorming)

1. **Full-backend approach.** The backend parses the plate metadata on import, extracts the embedded plate PNGs to storage, stores a plate manifest, and serves the thumbnails via an endpoint. The frontend consumes this; it only client-renders plate thumbnails as a fallback for files without Bambu plate data. **Existing files must be re-imported** to gain plate data.
2. **Relational storage — a `Plate` XPO entity** (child of `ModelFile`), consistent with the project's `FileFolder`/`FileTag` patterns, rather than a JSON blob column.
3. **Backend resolves object grouping to build-item indices.** Bambu's `<plate>` nodes reference `object_id`s; the parser maps each to a 0-based index into the `<build><item>` order (the same order `ThreeMFLoader` yields as `group.children`), so the frontend maps plates onto `model.objects` directly with no Bambu-id knowledge.
4. **Bambu-only detection, graceful fallback.** A file is treated as multi-plate only when `Metadata/model_settings.config` contains `<plate>` nodes. Prusa and other slicers are out of scope; they fall back to per-build-item behavior. Malformed/partial metadata never fails an import.
5. **Library grid thumbnail is unchanged** (stays the whole-model image) — out of scope.

---

## Backend

### Parsing on import (`ThreeMfMetadataParser` or a companion parser)
When parsing an uploaded 3MF, additionally read `Metadata/model_settings.config` if present. For each `<plate>` node collect:
- `plater_id` → **`Index`** (1-based as authored by Bambu; stored as-is).
- `plater_name` → **`Name`** (free text, e.g. `"Borders (6M & 6F)"`; may be empty → fall back to `"Plate {Index}"`).
- `thumbnail_file` → the embedded PNG zip entry (e.g. `Metadata/plate_1.png`).
- each `<model_instance>` `object_id` → resolved to a **build-item index** via the ordered `<build><item>` list in `3D/3dmodel.model` (item position 0..N-1). Unresolvable object_ids are skipped.

Effects:
- **`ModelFile.PlateCount`** = number of `<plate>` nodes when the config is present and non-empty; otherwise the existing build-item count (unchanged behavior).
- For each plate, the referenced PNG is **extracted from the 3MF zip and written to storage** at `{ThumbsDirectory}/{fileId}_plate_{index}.png`. A plate whose `thumbnail_file` is missing from the archive is stored with a null `ThumbnailPath` (endpoint 404s → frontend shows the stripe placeholder).

The parser returns the plate manifest (list of `{ index, name, thumbnailEntryName, buildItemIndices }`) alongside the existing `ModelMetadata`; the controller persists it after the `ModelFile` is saved (so `fileId` is known for thumbnail filenames).

### `Plate` entity
New XPO persistent class:
```
Plate {
  Oid
  File          -> Association to ModelFile  (Association "File-Plates")
  Index         int      // Bambu plater_id
  Name          string
  ThumbnailPath string?  // absolute path to the extracted PNG, or null
  BuildItemIndices string // comma-separated 0-based indices into <build> order, e.g. "0,3,7,9"
}
```
`ModelFile` gains `[Association("File-Plates")] XPCollection<Plate> Plates`.

**Deletion:** `FilesController.Delete` must, before purging the `ModelFile`, delete its `Plate` rows (`.Delete()` + `PurgeDeletedObjects()`) and remove each plate's on-disk PNG — mirroring the existing storage/thumbnail cleanup. (Per the project's XPO rule: `.Delete()` then `PurgeDeletedObjects()`; never `CommitTransaction()`.)

### API
- **File DTO** gains `plates`: `[{ index, name, buildItemIndices: int[] }]`, ordered by `Index`. The thumbnail path is not exposed; the URL is derived by the client. When a file has no plates the array is empty.
- **New endpoint `GET /api/files/{id}/plates/{index}/thumbnail`** → `PhysicalFile(plate.ThumbnailPath, "image/png")`; `404` when the file, the plate, or the PNG is missing. Same shape/pattern as the existing `GET /api/files/{id}/thumbnail`.
- Re-import overwrites: uploading is create-only today (no dedup), so a re-import produces a new `ModelFile` with fresh plates; the old record is deleted normally. No migration script — the `Plate` table is auto-created by XPO on first run.

---

## Frontend

### Unified plate model
Introduce `ViewerPlate = { label: string; thumbnailUrl: string | null; objectIndices: number[] }` and a builder in `lib/` (e.g. `viewerPlates.ts`):
- **Bambu file** (DTO `plates` non-empty): one `ViewerPlate` per plate — `label` = `name` (or `"Plate {index}"` if blank), `thumbnailUrl` = `/api/files/{id}/plates/{index}/thumbnail`, `objectIndices` = `buildItemIndices`.
- **Fallback** (no `plates`, multi-object 3MF): one `ViewerPlate` per build item — `label` = `"Plate {i+1}"`, `thumbnailUrl` = the client-rendered data URL from the existing `renderPlateThumbnails`, `objectIndices` = `[i]`.
- **Single-object / STL:** empty `ViewerPlate[]` → filmstrip hidden (unchanged).

`DetailView` builds `ViewerPlate[]` and passes it to the filmstrip; the two source paths converge so downstream code never branches on slicer type.

### Filmstrip & isolation
- `PlateFilmstrip` renders one cell per `ViewerPlate`: the thumbnail (server PNG for Bambu, client render otherwise, stripe placeholder if null), the 1-based index number, and the **plate name as the cell's `title` tooltip + accessible label** (names are too long for a 76px cell, so they surface on hover / to assistive tech). An "All" cell remains.
- Clicking a plate **isolates its whole object group**: isolation generalizes from a single index to "show exactly this plate's `objectIndices`, hide the rest." `lib/viewerModes.ts` gains a set-based isolation (e.g. `setVisibleObjects(objects, indices | null)`; `null` = show all); the existing single-index `setActivePlate` is either generalized or superseded by it.
- Solid / Wireframe / Plates render modes apply across whatever is currently visible (unchanged).

### Data flow
`DetailView` already fetches the file (now including `plates`) via `useFile` and the raw bytes via `/content`. It builds `ViewerPlate[]` from the DTO `plates` when present, else from the client render pass. Selecting a plate sets the active object-index set; the viewer applies `setVisibleObjects`.

---

## Error handling

- **No `model_settings.config`, or zero `<plate>` nodes** → no plates parsed; fallback path; no error.
- **Plate references a missing PNG entry** → plate stored with null `ThumbnailPath`; its endpoint 404s; filmstrip cell shows the stripe placeholder.
- **`object_id` with no matching build item** → that instance is skipped; the plate keeps its other objects.
- **Corrupt/unreadable config** → caught; the file imports without plate data (fallback), and the failure is logged, not surfaced to the user.
- **Frontend:** a missing/failed plate thumbnail falls back to the stripe placeholder via `<img onError>` (same pattern as elsewhere).

---

## Testing

### Backend (xUnit)
- Parse a small synthetic `model_settings.config` (2 plates, named, referencing object_ids) inside a minimal in-code 3MF: assert plate count, names, and `object_id → build-item index` resolution against the `<build>` order.
- Thumbnail extraction: a plate whose `thumbnail_file` exists is written to `{ThumbsDirectory}/{fileId}_plate_{index}.png`; a missing entry → null `ThumbnailPath`.
- `PlateCount` = plate count when present; unchanged (build-item count) when the config is absent.
- `GET /api/files/{id}/plates/{index}/thumbnail`: 200 + `image/png` when present; 404 for unknown file/index or missing PNG.
- `Delete` removes `Plate` rows and their on-disk PNGs.
- DTO includes the ordered `plates` array.

### Frontend (Vitest)
- `viewerPlates` builder: Bambu DTO → plates with server URLs + grouped indices; no-plates multi-object → per-build-item fallback with client thumbnails; single/STL → empty.
- `viewerModes` set-based isolation: `setVisibleObjects(objects, [1,3])` shows only those; `null` shows all.
- `PlateFilmstrip`: renders one cell per `ViewerPlate`, name as `title`/accessible label, server `<img src>` when a url is given, placeholder when null, click emits the plate.
- The real Bambu file (`BathroomShelf-5x13.3mf`) is the **manual verification fixture**: 7 named plates, embedded thumbnails, grouped isolation; WebGL rendering verified by running the app (per the Phase 5 precedent).

---

## Out of scope / deferred

- **Other slicers** (Prusa `Metadata/Slic3r_PE_model.config`, etc.) — Bambu-only; others fall back to build-items.
- **Library grid thumbnail** — stays the whole-model image (not a plate image).
- **Re-parsing existing files in place** — no migration/backfill; existing files gain plate data only on re-import (called out in the README).
- **Per-plate metadata beyond name/thumbnail/grouping** (filament maps, print time per plate, etc.) — not surfaced.
- The client-side `renderPlateThumbnails` path is retained solely as the non-Bambu fallback.
