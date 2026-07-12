# Collections + Tags Model — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan

## Problem

The app currently exposes three organizing surfaces that confuse the mental model:

- **Library folders** — user-created, nestable, many-to-many (`Folder`, `IsSystem = false`).
- **Collections** — the *same* `Folder` entity with `IsSystem = true`, seeded as Favorites / Printed / To Print / Failed Prints, rendered in a separate sidebar section and locked from rename/reparent/delete.
- **Tags** — a separate flat, colored, many-to-many `Tag` entity.

Because "Library folders" and "Collections" are literally one entity split only by a flag, and the detail panel calls that same thing "Folders," users see three words (Library / Collections / Folders) for what is really two mechanisms. The system collections are also really *status* (Printed, To Print…), which is an awkward fit for hierarchical grouping.

## Decision

Reduce to **two clearly-named, independent organizing axes**:

1. **Collections** — user-created, nestable groups a file belongs to (many-to-many). Absorbs today's "Library folders." The `IsSystem` concept and the seeded system collections are **removed entirely**. Every collection is user-editable.
2. **Tags** — flat, colored labels. Cross-cutting. Users create their own status tags (e.g. "Printed", "To Print") — **no seeded defaults**.

The words "Library" and "Folders" disappear from the user-facing UI; the single term is **Collections** (plus **Tags**).

### Filtering model

- **Collection = scope.** Selecting a collection scopes the grid to that collection and its descendants (existing descendant-inclusive behavior, unchanged). Default scope is **All Files** (kept, top of the Collections section).
- **Tags = narrowing within scope.** Multiple tags combine with **AND**. Clicking a tag toggles it into/out of the active filter.
- **Combined result** = `scope(collection) ∩ { files having ALL selected tags }`, still combinable with the existing search box (`q`).
- Tag selection **persists** as the user switches collections.
- Active tag filters are shown as **chips in the toolbar** with a clear affordance, so filter state is always visible.

### Migration

**None.** The database contains only test data, so the previously-seeded system collections can be discarded by resetting the dev DB. No cleanup code, no data migration.

## Scope

### Backend (`backend/PlasticRoom.Api`)

- **`GET /api/files`**: add `tagIds` (repeatable query param, `List<int>?`). A file matches only if it contains **all** supplied tag ids (AND). Applied after the folder scope and combined with `q`. `folderId` and `q` behavior unchanged. Empty/absent `tagIds` = no tag filter.
- **Remove system-collection machinery:**
  - Delete `Data/FolderSeeder.cs` (seeds the four system collections) and its startup invocation.
  - Drop `IsSystem` from the `Folder` entity (`Entities/Folder.cs`) and from `FolderDto` (`Dtos/FolderDtos.cs`).
  - Remove the `IsSystem` guards in `FoldersController` (rename / reparent via `Update`, `Order`, and `Delete` no longer special-case system folders — all collections are fully editable).
- No entity/schema change beyond dropping `IsSystem` (dev DB reset covers it). `SampleDataSeeder` keeps seeding sample *files/collections* but must not depend on system collections.

### Frontend (`frontend/src`)

- **Sidebar (`components/Sidebar.tsx`)**: collapse to a single **COLLECTIONS** section (All Files + user collections, all editable — existing rename/delete/drag already supports non-system folders) plus a new **TAGS** section:
  - Tags render as colored dot + name; clicking toggles membership in the active tag filter; active tags are visually highlighted.
  - Remove the separate "Library" vs "Collections" rendering split and all `isSystem` branching.
- **`views/LibraryView.tsx`**: own `selectedTagIds: number[]`; pass to `useFiles`. Tag selection persists across collection changes. Render active-filter chips + clear in the toolbar (`LibraryToolbar`).
- **`hooks/useFiles.ts`**: add `tagIds` parameter to the query (new effect dependency).
- **`api/client.ts` (`getFiles`)**: append repeatable `tagIds` query params.
- **Terminology cleanup — "Folders" / "Library" → "Collections"** everywhere user-facing:
  - Detail panel folder section (`components/detail/DetailInfoPanel.tsx`, `components/FileDetailPanel.tsx`).
  - Batch panel (`components/BatchAssignPanel.tsx`).
  - Import assign panel (`components/import/ImportAssignPanel.tsx`).
  - Assign modal (`components/AssignFoldersModal.tsx`): drop the two-group COLLECTIONS/LIBRARY split → one flat collection tree; retitle to "Assign collections". (Component/file rename optional — out of scope to limit churn; visible copy updated.)
- **Types/utils**: drop `isSystem` from the `Folder` type (`api/types.ts`) and `FolderNode` (`lib/folderTree.ts`); update consumers that branched on it (Sidebar, AssignFoldersModal).

### Testing

- **Backend**: new `tagIds` AND-filter tests on `GET /api/files`; update/remove `FolderSeederTests`, `FoldersControllerTests` (system guards gone), and any `SampleDataSeederTests` assuming system collections.
- **Frontend**: tag-filter toggle + combined (collection ∩ tags ∩ search) filtering; `getFiles` tagIds query wiring; updated `Sidebar`, `AssignFoldersModal`, `App`, `LibraryView`, `folderTree` tests that assumed the Library/Collections split.

## Non-goals

- Renaming component/test **files** (e.g. `AssignFoldersModal` → `AssignCollectionsModal`) — copy is updated, filenames left to avoid churn.
- OR-tag filtering, saved filters, or tag management UI (color editing, rename) beyond what already exists.
- Any change to import parsing, the viewer, or plate metadata.

## Interfaces (summary)

- `GET /api/files?folderId={int?}&tagIds={int}&tagIds={int}&q={string?}` → files in scope having all tags, matching search.
- `Folder` (entity, DTO, TS type): no `IsSystem` field.
- `useFiles(folderId, tagIds, q)` and `getFiles(folderId, tagIds, q)`.
- `LibraryView` state: `selectedFolderId: number | null`, `selectedTagIds: number[]`.
