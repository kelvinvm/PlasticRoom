# CLI Catalog MVP — Design

## Problem

The core need is: get 3D-print files into a searchable catalog quickly, and find them
back later in groups ("things") even when the exact filename/model name isn't
remembered. The product had grown into a full web UI (editable metadata fields, nested
collections, tag-assignment modals, drag-and-drop folder moves) before that core loop
was validated, and in practice it's still faster to go spelunking on the hard drive
than to use the app: no batch/zip import, one-at-a-time folder moves, tag/collection
creation not available during import, stale filter counts.

This spec scopes back down to the smallest thing that improves on "search the hard
drive, redownload if I can't find it": a CLI that gets import and organization right,
with no UI investment until that loop is proven.

## Non-goals for this pass (deferred, not deleted)

- Any GUI. The existing web frontend (FileDetailPanel, DetailInfoPanel,
  AssignFoldersModal, editable-metadata-fields work) is shelved as-is, not removed.
- Modular/pick-and-mix parts systems (a library of interchangeable parts where the
  set you need changes each time). Only self-contained models and fixed groups
  ("always print these N files together") are in scope.
- Nested Folder/Collection hierarchy. Replaced entirely by Designer + Model grouping
  + Tags for this phase. If a cross-cutting saved-set concept is needed later
  (e.g. "current print queue"), it comes back as a deliberate feature, not leftover
  plumbing.
- Bulk move-between-collections UI, thumbnail display/browsing (the user is not
  visual; text search on name/designer/tag is sufficient for recall).

## Storage model

Files are extracted from the imported zip and moved into the user's own
NAS-synced, 3-2-1-backed-up folder tree — not copied into app-private managed
storage. PlasticRoom's DB stores paths and references those files in place, the
way Lightroom catalogs originals rather than owning a second copy. No duplicate
backup role for the app; it only needs reliable read access to the path.

## Data model changes

Minimal additions to the existing schema:

- **Designer**: promoted from the existing loose `ModelFile.Creator` string to a
  real lookup entity — just a name for now (no profile/detail beyond that), but
  queryable and reused across models instead of retyped per file.
- **Model** (the "thing"): new grouping entity — name, Designer reference,
  destination folder path, tags, list of member files. This is the unit that
  tags and search apply to.
- **Tags**: existing many-to-many tag concept, reattached to Model instead of to
  individual files.
- **ModelFile**: existing entity (parsed 3MF metadata, plate info, STL part
  lists) now attaches to a Model rather than standing alone or attaching to a
  Folder.

Backend reuse: the existing 3MF/STL parsing, plate extraction, and thumbnail
extraction logic (`BambuPlateParser`, `FileStorage`, etc.) stays as-is and is
reused by the CLI — either as a thin client of the existing API or by calling
the service layer directly, whichever is lower-friction for local dev. Keeping
the backend separate from the CLI's presentation logic is deliberate: a real
UI is expected to sit on top of this backend eventually.

## Commands

### `import <path-to-zip>`

1. Extract the zip to a scratch/temp location; inspect contents (3MF/STL/PDF/
   readme files found).
2. Guess Designer + Model name. Priority: the zip's internal folder name (if the
   archive unpacks into a single named folder, e.g. "Bramble Pint Holder") takes
   priority over the zip filename; fall back to the zip filename if there's no
   clean internal folder name; fall back to "unknown" if neither yields anything
   usable.
3. Propose a destination folder: `<library root>/<Designer>/<Model>/`.
4. Show a summary — guessed Designer, Model name, destination path, file list
   (3MF/STL/PDF counts) — and let the user edit any field interactively before
   confirming.
5. On confirm: move extracted files to the destination folder; create/reuse the
   Designer row; create the Model row and ModelFile rows pointing at the
   destination paths.
6. Prompt for tags (comma-separated, reuse existing tag names or create new ones
   inline). **Tagging is skippable** — a model can be imported with zero tags
   and tagged later via `tag`.

### `find <term>`

Text search across Model name, Designer name, and tags (substring match).
Prints matches: Model name, Designer, tags. Untagged models still match on
name/designer.

### `list designers`

All designers with a count of models each.

### `list models --designer <name>` / `list models --tag <name>`

Filtered listing of models.

### `list untagged`

Nudge command: lists models with zero tags, so tags skipped at import time
don't get lost/forgotten.

### `show <model>`

Prints Designer, tags, destination folder, and the file list broken out (3MF
plates if present, individual STL parts, PDF/readme path). This answers "what
do I print and where's the manual."

### `tag <model> <tag...>`

Adds tags to an already-imported model — the completion path for imports where
tagging was skipped.

### `export <model> [--dest <path>]`

Copies all files belonging to a model (3MF, STLs, PDF/readme) into one folder
— a temp directory by default, or a specified destination — ready to hand to
slicer software. Useful even though import already colocates files, and sets
up the pattern needed later for modular systems where a "thing" really is
assembled from files across multiple locations.

## Existing data

No migration. There's nothing of value in the current DB (folders/collections,
per-file tags, imported files) — it gets discarded, and the schema is free to
change shape (Designer/Model tables, tags moving from per-file to per-Model)
without a migration path.

## Out of scope / open questions for later

- How designer/model name guessing behaves when a zip contains multiple
  unrelated models (not addressed now; assume one model per zip for this MVP).
- Loose files/folders not packaged as a zip (`import` is zip-only for this
  pass; bulk-importing existing unzipped STL collections is a separate problem).
- Modular/pick-and-mix systems and how `export` generalizes to assembling a set
  of files from multiple Models.
