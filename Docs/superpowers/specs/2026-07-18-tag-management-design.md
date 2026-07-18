# Tag Management (rename / recolor / delete) — Design

**Date:** 2026-07-18
**Status:** Approved, pending implementation plan
**Branch:** `tag-management-backlog`

## Goal

Tags today can only be created (`POST /api/tags`, inline during import or in the batch panel). Add the ability to rename a tag, change its color, and delete a tag, from the Sidebar's Tags section — the natural home now that Collections + Tags is the app's organizing model.

## Decisions (locked during brainstorming)

1. **Merge is out of scope.** Combining two tags into one (reassign every `FileTag` from a losing tag to a winner, then delete the loser) stays a separate, larger backlog item.
2. **Color palette is unchanged.** The 4 existing colors (brass `#dbb55a`, orange `#ff8a3d`, green `#3ddc97`, red `#e0654a`, all in `frontend/src/lib/format.ts`) are what recolor picks from — no new colors, no custom picker. The user reviewed the actual swatches (with red/green color-vision considerations in mind) and confirmed they're distinguishable enough, especially since every tag row always pairs the color dot with a text name. Customizable/user-defined tag colors is logged separately as `Docs/future-refinements.md` item #9 (a future Settings-page feature).
3. **UI pattern:** a right-click context menu on each tag row — **Rename / Recolor / Delete** — mirroring the existing folder context menu exactly, not a new "Edit tag" modal. Recolor opens a small popover of the 4 color dots anchored to the row; picking one applies immediately and closes the popover.

## Current state (context)

- **Backend** `TagsController` (`backend/PlasticRoom.Api/Controllers/TagsController.cs`) only has `GetAll` and `Create`. `Tag` entity (`Entities/Tag.cs`) is just `Name` + `ColorKey`, with an XPO association to `FileTag` (`Tag-FileTags`). `TagDto`/`CreateTagRequest` live in `Dtos/TagDtos.cs`.
- **Folder delete precedent** (`FoldersController.Delete`) shows the required XPO `Session` shape for tags: delete child join rows first, then the entity, then a single `session.PurgeDeletedObjects()` — no `BeginTransaction()`/`CommitTransaction()` needed for this shape (that pair is only used by the folder reorder endpoint's multi-row batch write).
- **Frontend** `hooks/useTags.ts` fetches once and has no `reload()` (unlike `useFolders`/`useFiles`). `components/Sidebar.tsx` renders the Tags section as a flat list of plain toggle buttons (lines ~336-351) — no context menu, no inline rename, no per-row state at all today. The folder rows just above it already have the full pattern: a single `openMenuId` lifted to `Sidebar`, dismissed via a `document` click/Escape effect, inline rename (label→input, Enter/blur commit, Esc cancel), and a `ConfirmDialog` for delete.
- `LibraryView.tsx` owns `selectedTagIds: number[]` (the active tag filter) and passes `activeTags`/`onRemoveTag` down to `LibraryToolbar` for the removable filter chips.

## Architecture

### Backend

`TagsController` gains two actions, following the `Tag` entity's existing shape:

```csharp
[HttpPut("{id}")]
public IActionResult Update(int id, [FromBody] UpdateTagRequest request)
{
    // 404 if not found
    // 400 if request.ColorKey is set but not one of the known keys
    // tag.Name = request.Name; tag.ColorKey = request.ColorKey; tag.Save();
}

[HttpDelete("{id}")]
public IActionResult Delete(int id)
{
    // 404 if not found
    // foreach (var ft in tag.FileTags.ToList()) ft.Delete();
    // tag.Delete();
    // session.PurgeDeletedObjects();
    // return NoContent();
}
```

New DTO: `UpdateTagRequest(string Name, string? ColorKey)` in `Dtos/TagDtos.cs`.

**Color validation:** the 4 valid keys (`brass`, `orange`, `green`, `red`) are already implicitly defined in `frontend/src/lib/format.ts`'s `TAG_COLORS`. Add a matching backend constant (a `static readonly HashSet<string>` in `TagsController` or a small shared const) so `Update` rejects an unknown `ColorKey` with `400`, rather than silently accepting arbitrary strings.

### Frontend

**`api/client.ts`** — add, mirroring `updateFolder`/`deleteFolder`:
```ts
export async function updateTag(id: number, name: string, colorKey: string | null): Promise<Tag>
export async function deleteTag(id: number): Promise<void>
```

**`hooks/useTags.ts`** — add a `reload()` returned alongside `tags`/`loading`/`error`, same `reloadIndex`-bump pattern as `useFolders`.

**`components/Sidebar.tsx`** — Tags section changes:
- Tag rows become right-clickable. A **separate** `openTagMenuId: number | null` state (not reusing folders' `openMenuId`) keeps the two context-menu systems independent, since a folder id and a tag id can coincidentally collide as numbers. Same dismiss-on-outside-click/Escape effect as folders, duplicated for this second piece of state.
- Context menu items: **Rename**, **Recolor**, **Delete**.
  - **Rename** swaps the row's label for a text input (Enter/blur commit via `updateTag(id, trimmed, tag.colorKey)`, Esc cancel) — same interaction as folder rename.
  - **Recolor** renders a small popover of 4 `<button>` color dots (brass/orange/green/red) anchored under the row. Clicking one calls `updateTag(id, tag.name, key)`, closes the popover, and calls `reload()` (from `useTags`).
  - **Delete** opens the existing `ConfirmDialog` component: *Delete "{name}"? Files keep their other tags but lose this one.* On confirm: `deleteTag(id)` → `reload()` (tags) → if `id` is in `selectedTagIds`, notify the parent to drop it (see below). On failure: dialog stays open with an inline error, same as folder delete.
- New prop threaded from `LibraryView`: `onTagDeleted: (id: number) => void`.

**`views/LibraryView.tsx`** — `onTagDeleted` removes the id from `selectedTagIds` (`setSelectedTagIds((ids) => ids.filter((x) => x !== id))`) so `useFiles`'s query and the toolbar's `activeTags` chips both drop the ghost tag automatically (both are already derived from `selectedTagIds`).

## Error handling

- **Recolor/rename network failure:** no optimistic update — the row only changes after `updateTag` resolves and `reload()` runs, so a failure just leaves the row as it was. (Matches how folder rename currently behaves; no separate error UI needed here since these are quick, low-stakes edits — unlike delete, which already has the `ConfirmDialog` error slot.)
- **Delete network failure:** `ConfirmDialog` stays open with an inline error; tag and its assignments are untouched.
- **Deleting the tag currently filtering the grid:** `selectedTagIds` cleanup (above) means the filter and its chip disappear along with the tag, rather than silently filtering on a nonexistent id forever.

## Testing

- **Backend (`TagsControllerTests.cs`):** `Update` renames + recolors an existing tag (200 + updated DTO); `Update` on unknown id → 404; `Update` with an invalid `ColorKey` → 400; `Delete` removes the tag and its `FileTag` rows (verify via a follow-up `GetAll` / files-by-tag query no longer includes it); `Delete` on unknown id → 404.
- **Frontend (`Sidebar.test.tsx`):** right-click a tag row opens its context menu; Rename commits on Enter/blur and cancels on Esc; Recolor popover applies a color and closes; Delete opens `ConfirmDialog` and calls `deleteTag` + `onTagDeleted` on confirm; a rejected delete keeps the dialog open with an error; opening one tag's menu closes another open menu (single-open, mirroring the folder behavior).
- **Frontend (`LibraryView.test.tsx`):** deleting a tag that's active in `selectedTagIds` removes it from the filter and its toolbar chip.

## Files

**Modified**
- `backend/PlasticRoom.Api/Controllers/TagsController.cs` — `Update`, `Delete` actions + color-key validation
- `backend/PlasticRoom.Api/Dtos/TagDtos.cs` — `UpdateTagRequest`
- `backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs` — new coverage
- `frontend/src/api/client.ts` — `updateTag`, `deleteTag`
- `frontend/src/hooks/useTags.ts` — `reload()`
- `frontend/src/components/Sidebar.tsx` (+ `.module.css`) — tag context menu, rename, recolor popover, delete wiring, `onTagDeleted` prop
- `frontend/src/components/Sidebar.test.tsx` — new coverage
- `frontend/src/views/LibraryView.tsx` — pass `onTagDeleted`, drop id from `selectedTagIds`
- `frontend/src/views/LibraryView.test.tsx` — new coverage
- `Docs/future-refinements.md` — remove item #8 once shipped (item #9, customizable tag colors, stays)

**No new files** — this reuses `ConfirmDialog` and the folder context-menu pattern rather than introducing new components.

## Out of scope (future)

- Tag merging (`Docs/future-refinements.md` #8's "optional, larger" note).
- Customizable/user-defined tag colors via Settings (`Docs/future-refinements.md` #9, newly logged).
- Bulk tag delete/rename.
