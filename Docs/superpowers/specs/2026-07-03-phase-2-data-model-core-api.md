# Phase 2 — Data Model & Core API

**Date:** 2026-07-03
**Status:** Spec approved, implementation not started
**Parent:** [Project Overview](2026-07-02-plastic-room-project-overview.md)

---

## Goal

All XPO entities created against the existing SQLite database, with REST CRUD endpoints for folders, files, and tags — including file upload with server-side metadata parsing, thumbnail upload, and the many-to-many folder/tag assignment endpoints that later screens (multi-assign, batch tagging) will build on.

## Design Decisions Made This Phase

- **Collections are not a separate concept.** The overview spec's open question ("special-cased Folder rows vs. a separate Collection entity") is resolved by not needing a `Type` discriminator at all: there is a single `Folder` entity with one boolean, `IsSystem`. The four seeded rows (Favorites, Printed, To Print, Failed Prints) are ordinary folders with `IsSystem = true`, `ParentFolder = null`. They nest, get files assigned, and get read back exactly like any other folder — the only differences are: (a) the API blocks rename/reparent/delete on them, and (b) the frontend groups them into a separate "COLLECTIONS" sidebar section purely as a rendering choice based on `IsSystem`, with no dedicated endpoint or query param.
- **Folder nesting is unrestricted for every folder**, system or not. There is no flat/no-nesting special case.
- **`SourceUrl` and `Creator`** were added to `File` (not in the original overview spec) to track where a model came from and who designed it. `SourceUrl` is validated server-side as a well-formed absolute URL; `Creator` is free text.
- **Only dimensions, plate count, and file size are auto-parsed** from the uploaded file in this phase. `EstPrintTimeMin`, `Material`, and `LayerHeightMm` are nullable fields filled in later via manual edit — slicer-specific metadata parsing is out of scope.

---

## Data Model (XPO entities)

```
Folder     { Oid, Name, ParentFolder (self-ref, nullable), Description,
             CoverImageFile (→File, nullable), SortOrder, IsSystem (bool) }

File       { Oid, Name, Type (ThreeMf | Stl), SizeBytes, AddedAt,
             DimXMm, DimYMm, DimZMm (double?, parsed),
             PlateCount (int?, parsed),
             EstPrintTimeMin (int?, manual), Material (string?, manual), LayerHeightMm (double?, manual),
             SourceUrl (string?, manual, validated), Creator (string?, manual),
             Description (string?), StoragePath (string), ThumbnailPath (string?) }

FileFolder { Oid, File (→File), Folder (→Folder) }   -- many-to-many join

Tag        { Oid, Name, ColorKey }

FileTag    { Oid, File (→File), Tag (→Tag) }         -- many-to-many join
```

Implementation notes:
- `Folder.ParentFolder` is a self-association (`[Association("FolderChildren")]` / `XPCollection<Folder> Children`).
- `FileFolder` and `FileTag` are explicit join classes (not XPO's implicit many-to-many collection sugar), matching the entity names already fixed in the project overview.
- `File.StoragePath` points at `/data/files/{guid}.{ext}`; the GUID is generated client-of-the-database-side (in the controller) before the file is written, so the path is known before the `File` record is first saved — no two-phase commit needed.
- `IsSystem` folders are seeded idempotently on startup (check by `Name` + `IsSystem = true`, create if missing): Favorites, Printed, To Print, Failed Prints.

---

## Metadata Parsing (C#, no external library)

- **STL** (binary format): skip the 80-byte header, read the `uint32` triangle count, stream the vertex data, compute a bounding box across all vertices → `DimXMm/DimYMm/DimZMm`. No plate concept for STL — `PlateCount = null`.
- **3MF** (ZIP + XML): open as a `System.IO.Compression.ZipArchive`, parse `3D/3dmodel.model` with `System.Xml`, compute a bounding box across all `<vertex>` elements in all `<mesh>` nodes, and set `PlateCount` to the count of `<item>` elements under `<build>`. This is a simplification — it counts top-level build items, not true slicer-specific plate/plate-image metadata (e.g. Bambu/Prusa project-specific plate config), which is out of scope for this phase.
- `EstPrintTimeMin`, `Material`, `LayerHeightMm` are never auto-populated in this phase.

---

## Endpoints

```
GET    /api/folders
    → flat list of all folders (including IsSystem); client builds the tree

POST   /api/folders
    body: { name, parentId?, description? }
    → creates a folder with IsSystem = false

PUT    /api/folders/{id}
    body: { name?, parentId?, description?, sortOrder?, coverImageFileId? }
    → 400 if IsSystem = true and name or parentId is being changed;
      description / sortOrder / coverImageFileId may still be updated on system folders

DELETE /api/folders/{id}
    → 400 if IsSystem = true
    → otherwise cascades: deletes this folder's FileFolder rows, recursively deletes
      descendant folders and their FileFolder rows (files themselves are never deleted)

GET    /api/files
    query: ?folderId= (optional)
    → list of all files, or files directly assigned to folderId (descendant-inclusive
      filtering is an explicit open question deferred to Phase 3 per the overview spec)

GET    /api/files/{id}

POST   /api/files
    multipart form: file (binary), folderIds[]? , tagIds[]? , sourceUrl?, creator?
    → parses metadata per file Type, writes binary to /data/files/{guid}.{ext},
      creates the File record (+ initial FileFolder/FileTag rows if provided)
    → 400 if sourceUrl is present and not a well-formed absolute URL

PUT    /api/files/{id}
    body: { description?, material?, estPrintTimeMin?, layerHeightMm?, sourceUrl?, creator? }
    → only these fields are editable; Dimensions/PlateCount/SizeBytes/Type/StoragePath are not
    → 400 if sourceUrl is present and not a well-formed absolute URL

DELETE /api/files/{id}
    → deletes this file's FileFolder and FileTag rows, deletes the blob at StoragePath and
      the thumbnail at ThumbnailPath (if set) from disk, then deletes the File record

POST   /api/files/{id}/thumbnail
    multipart form: file (PNG binary)
    → writes to /data/thumbs/{id}.png, sets File.ThumbnailPath

PUT    /api/files/{id}/folders
    body: { folderIds: [...] }
    → diffs against current FileFolder rows for this file: creates rows for newly-added
      ids, deletes rows for removed ids

PUT    /api/files/{id}/tags
    body: { tagIds: [...] }
    → diffs against current FileTag rows for this file, same semantics as folders

GET    /api/tags

POST   /api/tags
    body: { name, colorKey }
```

Error responses use `{ "error": "<message>" }` with an appropriate HTTP status code (400/404), consistent with the existing `/api/health` response shape.

---

## Not In Scope

- Batch tagging/assignment across multiple files at once (Phase 7 builds this on top of the single-file assignment endpoints above)
- Descendant-inclusive folder filtering for `GET /api/files?folderId=` (Phase 3 decision)
- Slicer-specific metadata parsing (print time, material, layer height)
- Any UI — this phase is API-only

---

## Success Criteria

- All five XPO entity classes (`Folder`, `File`, `FileFolder`, `Tag`, `FileTag`) build and create their schema against SQLite via the existing `XpoSessionFactory`
- The four `IsSystem` folders exist after a fresh app start, and are not duplicated on subsequent restarts
- Uploading a real STL and a real 3MF file via `POST /api/files` produces a `File` record with correct `DimXMm/Y/Z`, `PlateCount` (3MF only), and `SizeBytes`
- `PUT /api/files/{id}/folders` and `PUT /api/files/{id}/tags` correctly add and remove join rows when called with different id sets across two calls
- Attempting to rename, reparent, or delete an `IsSystem` folder returns 400
- `POST`/`PUT` on `File` with a malformed `sourceUrl` returns 400; a well-formed one is stored and round-trips on `GET`

---

## Testing

- xUnit tests for the STL and 3MF parsers against small fixture files checked into `PlasticRoom.Api.Tests`
- Controller tests using the same temp-directory `XpoSessionFactory` pattern established in `HealthControllerTests`
