# Editable File Metadata + Tag Assignment — Design

**Date:** 2026-07-18
**Status:** Approved, pending implementation plan
**Branch:** `file-detail-editing`

## Goal

Today, six fields on a file (`description`, `sourceUrl`, `creator`, `material`,
`estPrintTimeMin`, `layerHeightMm`) are never set anywhere in the UI — not at import,
not after. Only `description` is even editable (in the full-screen viewer's info
panel). Tag assignment for a single already-imported file is also missing entirely —
today a tag can only be attached during import or via multi-select batch assign.

This makes all six fields editable, in both of the app's two near-identical
file-detail panels, and adds single-file tag assignment reusing the existing
folder-assignment modal. **The backend already fully supports every part of this**
(`PUT /api/files/{id}` accepts all six fields; `PUT /api/files/{id}/tags` mirrors the
existing `PUT /api/files/{id}/folders`) — this is a frontend-only change.

## Decisions (locked during brainstorming)

1. **Both panels get the same feature set.** `frontend/src/components/FileDetailPanel.tsx`
   (grid view's right-side panel) and `frontend/src/components/detail/DetailInfoPanel.tsx`
   (full-screen viewer's info panel) both gain editable fields and tag assignment,
   rather than only fixing the one the user was using.
2. **Auto-parsing from the 3MF/STL file is explicitly out of scope.** Source URL can
   never be derived from the file. Creator sometimes exists as generic 3MF
   `<metadata>` but nothing parses it today. Material/print-time/layer-height *are*
   genuinely present in Bambu-specific `Metadata/slice_info.config` /
   `Metadata/project_settings.config` (the same kind of file `BambuPlateParser.cs`
   already reads for plates) — but that's slicer-specific parsing (Bambu only) that
   the project has already deferred twice (Phase 2 spec, Bambu plate metadata work).
   Logged as a new backlog item; this spec covers manual editing only.
3. **All six fields become editable**, not just Description + Source URL — since the
   backend already accepts all of them on one `PUT /api/files/{id}` call, scoping down
   would save no implementation cost, only feature value.
4. **Tag assignment reuses one combined modal.** `AssignFoldersModal` gains a second
   checklist section for Tags (flat list + inline create, mirroring the
   `BatchAssignPanel` tag picker), rather than a second independent "+ add" button and
   modal. The existing single "+ add" button in each panel opens this now-combined
   modal.

## Current state (context)

- **Backend, already complete, no changes needed:**
  - `FilesController.Update` (`PUT /api/files/{id}`, `Dtos/ModelFileDtos.cs:43`
    `UpdateFileRequest(string? Description, string? Material, int? EstPrintTimeMin,
    double? LayerHeightMm, string? SourceUrl, string? Creator)`) already validates
    `SourceUrl` server-side and partially updates whichever fields are non-null.
  - `FilesController.SetTags` (`PUT /api/files/{id}/tags`, body `IdListRequest { Ids }`)
    already exists and is byte-for-byte the same shape/behavior as the existing
    `SetFolders` (`PUT /api/files/{id}/folders`) that `AssignFoldersModal` already
    calls via `setFileFolders`.
- **Frontend, what exists today:**
  - `api/client.ts` has `updateFileDescription(id, description): Promise<ModelFile>`
    (PUTs `{ description }` only) and `setFileFolders(id, folderIds)`. No
    `updateFile` (general) or `setFileTags` exist yet.
  - `DetailInfoPanel.tsx` (full-screen) has ONE editable field: `description`, a
    `<textarea>` that auto-saves `onBlur` via `updateFileDescription`, with a
    `saving`/`saveError` hint pattern re-synced on `file.id` change (see the
    `eslint-disable-next-line react-hooks/exhaustive-deps` comment there explaining
    why the effect intentionally depends on `file.id` only). It shows Dimensions, Est.
    print time, Material, Layer height, Plates as read-only `<dl>` rows (no Creator,
    no Source URL at all), and a single "COLLECTIONS" section mixing folder AND tag
    chips together with one "+ add" pill that opens `AssignFoldersModal` (folders
    only today).
  - `FileDetailPanel.tsx` (grid view) shows Type, Size, Dimensions, Plates, Print
    time, Material, Layer height, Creator as read-only `<dl>` rows, `description` as
    plain read-only text (not editable at all), `sourceUrl` as a read-only `<a>` link,
    and two separate chip groups: "Collections" (chips + "+ add" pill →
    `AssignFoldersModal`) and "Tags" (chips only, hidden entirely if empty, no add
    control).
  - `AssignFoldersModal.tsx` renders a folder checkbox tree (`buildFolderTree`) with
    inline "+ New collection" create, and calls `setFileFolders` on Save. It takes
    `file: { id, name, folderIds }` — narrower than the full `ModelFile` type.
  - `BatchAssignPanel.tsx` already has a working tag checklist UI pattern (search +
    checkbox list + staged pills) to model the new tag section on, though it's a
    "stage now, apply as a batch of adds" model — this spec's modal instead mirrors
    `AssignFoldersModal`'s "start pre-checked from current state, Save sets the exact
    membership" model, since it's editing one file's actual assignment, not staging
    additions across many files.

## Architecture

### `api/client.ts` changes

Replace `updateFileDescription` with a general partial-update function (same
call-site count is tiny — 1 in `DetailInfoPanel.tsx` — so migrating it is cheap):

```ts
export interface FilePatch {
  description?: string
  sourceUrl?: string
  creator?: string
  material?: string
  estPrintTimeMin?: number
  layerHeightMm?: number
}

export async function updateFile(id: number, patch: FilePatch): Promise<ModelFile> {
  const url = `/api/files/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}
```

Add, mirroring `setFileFolders` exactly:

```ts
export async function setFileTags(id: number, tagIds: number[]): Promise<ModelFile> {
  const url = `/api/files/${id}/tags`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: tagIds }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}
```

### Editable-field pattern (applied to both panels, one field at a time)

Each of the six fields gets its own local `useState`, re-synced when `file.id`
changes (not on every `file` prop change, for the same reason `DetailInfoPanel`'s
existing `description` effect is `file.id`-scoped: a save round-trip echoes an
updated `file` object back through `reload()`, and re-syncing on that would fight
the user's in-progress edit). Each field saves independently `onBlur`, only if its
value actually changed from the file's current value — mirroring the exact shape of
`DetailInfoPanel`'s existing `handleBlur`:

```ts
async function handleFieldBlur<K extends keyof FilePatch>(
  key: K,
  value: FilePatch[K],
  currentValue: FilePatch[K],
  onSaved: (updated: ModelFile) => void,
  setSaving: (v: boolean) => void,
  setError: (v: boolean) => void,
) {
  if (value === currentValue) return
  setSaving(true)
  try {
    const updated = await updateFile(file.id, { [key]: value } as FilePatch)
    onSaved(updated)
    setError(false)
  } catch {
    setError(true)
  } finally {
    setSaving(false)
  }
}
```

(This is written inline per-field in each panel rather than as a shared hook —
six fields is little enough repetition that a generic hook would add more
indirection than it removes, consistent with the project's YAGNI stance elsewhere.)

Field-by-field treatment:
- **Description** — `<textarea>`, already exists in `DetailInfoPanel` (unchanged
  behavior); newly added to `FileDetailPanel` (was previously read-only `<p>`).
- **Source URL** — `<input type="url">`. New in both panels (currently only a
  read-only link in `FileDetailPanel`, absent entirely from `DetailInfoPanel`).
  Client-side leaves validation to the server (`TryValidateSourceUrl` already
  400s on a malformed URL) — a failed save surfaces via the same inline error hint,
  reusing the existing error-hint pattern rather than adding client-side URL
  validation.
- **Creator** — `<input type="text">`. New editable in both.
- **Material** — `<input type="text">`. New editable in both.
- **Est. print time** — `<input type="number" min="0">`, minutes (matches
  `EstPrintTimeMin`'s existing unit). Empty input maps to not sending the field
  (leaves it unchanged) rather than sending `0`, matching how blank stays blank.
- **Layer height** — `<input type="number" min="0" step="0.01">`, mm.

For number fields, `handleFieldBlur` compares against the file's current numeric
value (or `undefined` if the input was left blank) and skips the call when
unchanged, same as the string fields.

### Tag assignment: `AssignFoldersModal` becomes dual-purpose

Extend `AssignFoldersModal.tsx` in place (no new file — same reasoning the project
already applied to `Sidebar.tsx`/`AssignFoldersModal.tsx` keeping their names through
the Collections+Tags model change, to limit churn):

- New props: `tags: Tag[]`, `onTagCreated: (created: Tag) => void` (mirrors
  `onFolderCreated`). `file` prop's type gains `tagIds: number[]` (it's already
  passed the full `ModelFile` at both call sites, so this is just widening the
  narrow inline type already declared on `AssignFoldersModalProps.file`).
- New local state: `checkedTags: Set<number>` (seeded from `file.tagIds`,
  parallel to the existing `checked` for folders), plus the same
  `showNewTag`/`newTagName` inline-create pair as folders use, calling the existing
  `createTag` client fn.
- New section in the modal body, below the folder tree, labeled "Tags" — a flat
  checkbox list (no tree/nesting, tags have none) with a colored dot per
  `tagColor(tag.colorKey)`, mirroring `BatchAssignPanel`'s tag row markup:
  ```tsx
  {tags.map((tag) => (
    <label key={tag.id} className={styles.tagOption}>
      <input type="checkbox" checked={checkedTags.has(tag.id)} onChange={() => toggleTag(tag.id)} />
      <span className={styles.tagDot} style={{ background: tagColor(tag.colorKey) }} />
      {tag.name}
    </label>
  ))}
  ```
- **Save** compares both `checked` (folders) against `file.folderIds` and
  `checkedTags` against `file.tagIds` independently; calls `setFileFolders` and/or
  `setFileTags` only for whichever actually changed (both, one, or neither — if
  neither changed, `onClose()` with no network call, same as today's folders-only
  behavior). If both changed, they're independent PUTs (not atomic together) — an
  acceptable gap since each individual PUT is already atomic and the modal already
  has an error path that keeps it open and lets the user retry.
- **Inline "+ New tag"** sits alongside the existing "+ New collection" in the
  footer; creates via `createTag(name, null)` (no color picker in the modal — new
  tags keep today's create-time auto-cycled color, recolor happens via the Sidebar
  tag management shipped previously), auto-checks the new tag, calls
  `onTagCreated(created)`.

### Panel-level wiring

- `FileDetailPanel.tsx`: the "Tags" chip group (today hidden when empty) becomes
  always-rendered with its own "+ add" pill *removed* — both Collections and Tags
  "+ add" affordances collapse into the one existing Collections "+ add" pill, which
  now opens the dual-purpose modal. (Only one "+ add" total per panel, per the
  locked decision — not two buttons opening the same modal.)
- `DetailInfoPanel.tsx`: unchanged single "COLLECTIONS" section/pill, now opening
  the dual-purpose modal — its existing mixed folder+tag chip display was already
  visually combined, so no chip-layout change needed there, just passing the new
  props through.
- Both panels pass `tags`, `onTagCreated` (wired to the same `reloadTags`-triggering
  callback pattern the Sidebar tag-management work established — the panel's
  existing `onFolderCreated`/`reloadFolders` plumbing is the template) alongside
  their existing `folders`/`onFolderCreated` props into the modal.

## Error handling

- **Per-field save failure:** inline "Couldn't save — try again" hint next to that
  field (matching `DetailInfoPanel`'s existing description error hint exactly); the
  typed value stays in the input (not reverted) so the user doesn't lose their edit,
  and blurring again (or an explicit re-trigger) retries.
- **Invalid Source URL:** the existing server-side `TryValidateSourceUrl` 400s;
  surfaces through the same per-field error hint as any other failed save — no new
  client-side URL validation is added.
- **Modal save failure (folders and/or tags):** existing behavior — inline banner
  error, modal stays open, nothing is lost since Save only commits after both
  calls succeed (the two PUTs can partially succeed if one fails, but the folder
  side already has this exact gap today unstaged — this spec doesn't change that
  existing behavior, only extends it symmetrically to tags).

## Testing

- **`api/client.test.ts`:** `updateFile` PUTs the given partial patch as JSON;
  `setFileTags` PUTs `{ ids }` to `/api/files/{id}/tags` (mirrors the existing
  `setFileFolders` test).
- **`FileDetailPanel.test.tsx`:** each of the six fields renders its current value
  and calls `updateFile` with the right partial patch on blur when changed; blurring
  unchanged makes no call; a rejected save shows the error hint and keeps the typed
  value; Tags chip group renders even when empty and its (sole, shared) "+ add" pill
  opens the modal.
- **`DetailInfoPanel.test.tsx`:** same per-field coverage as above, adapted to this
  panel's existing test patterns; existing description tests continue to pass
  unchanged (behavior is identical, just now backed by the general `updateFile`
  instead of `updateFileDescription`).
- **`AssignFoldersModal.test.tsx`:** new tag checklist toggles independently of the
  folder tree; Save calls `setFileFolders`/`setFileTags` only for the side(s) that
  changed; Save with nothing changed on either side makes no network call; "+ New
  tag" creates via `createTag`, auto-checks, and calls `onTagCreated`; existing
  folder-only tests continue to pass.

## Files

**Modified**
- `backend/PlasticRoom.Api/*` — **none** (already fully supports this)
- `frontend/src/api/client.ts` — replace `updateFileDescription` with `updateFile`;
  add `setFileTags`
- `frontend/src/api/client.test.ts` — updated/new coverage for the above
- `frontend/src/components/FileDetailPanel.tsx` (+ `.module.css`) — editable fields,
  always-rendered Tags chip group, pass `tags`/`onTagCreated` to the modal
- `frontend/src/components/FileDetailPanel.test.tsx` — new field coverage
- `frontend/src/components/detail/DetailInfoPanel.tsx` (+ `.module.css`) — editable
  fields (Source URL, Creator, Material, Est. print time, Layer height added;
  Description migrated to `updateFile`), pass `tags`/`onTagCreated` to the modal
- `frontend/src/components/detail/DetailInfoPanel.test.tsx` — new field coverage
- `frontend/src/components/AssignFoldersModal.tsx` (+ `.module.css`) — Tags
  checklist section, inline tag create, dual-purpose Save
- `frontend/src/components/AssignFoldersModal.test.tsx` — new tag coverage
- Call sites passing `folders`/`onFolderCreated` into `FileDetailPanel`/
  `DetailInfoPanel` (`LibraryView.tsx`, `DetailView.tsx`) — add `tags`/`onTagCreated`
  (both already have `tags` in scope; `onTagCreated` wires to the same reload
  plumbing `onFolderCreated` already uses)

**No new files** — this extends existing components in place, per the locked
decision to keep one combined modal rather than add a parallel one.

## Out of scope (future)

- Auto-parsing Material/Est. print time/Layer height from Bambu-specific 3MF
  metadata (`Metadata/slice_info.config`, `Metadata/project_settings.config`) —
  logged as a new `Docs/future-refinements.md` item.
- Any parsing for Creator or Source URL (Source URL is inherently non-derivable;
  Creator parsing from generic 3MF `<metadata>` is unproven/unreliable across
  sources and not attempted here).
- Setting any of these six fields at import time (the import staging flow is
  untouched by this spec).
- A color picker inside the new tag-create flow (new tags still auto-cycle color,
  same as today; recolor is a separate action via the Sidebar).
- Making the two folder/tag PUTs in the modal's Save atomic together (pre-existing
  gap, not introduced here).
