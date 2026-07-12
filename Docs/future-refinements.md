# Future Refinements

A running backlog of nice-to-have improvements, not yet specced or scheduled.
Each item lists enough context / code touchpoints to pick it up later. When an
item graduates to real work, brainstorm a spec under `Docs/superpowers/specs/`
and a plan under `Docs/superpowers/plans/`, then remove it from here.

---

## 1. Settings page + default view setting

Add a Settings page and a "default view" preference that chooses which render
mode a file's detail view opens in (Solid / Wireframe / Plates).

- **Render mode source of truth:** `RenderMode = 'solid' | 'wireframe' | 'plates'`
  in `frontend/src/lib/viewerModes.ts`. Today `DetailView` hard-codes the initial
  mode: `const [mode, setMode] = useState<RenderMode>('solid')`
  (`frontend/src/views/DetailView.tsx`). The setting would seed that initial value.
- **Where settings live — decide during brainstorming:**
  - *Client-only (localStorage):* simplest, no backend change; but per-browser, not
    shared across devices / the Docker deployment.
  - *Backend-persisted:* new `Settings` concept (XPO entity or a simple key/value)
    + `GET/PUT /api/settings` on the API. Shared across devices; more work. Follow the
    existing XPO `Session` rules (no `CommitTransaction()`; `PurgeDeletedObjects()`
    after deletes — see project memory).
- **Navigation:** there is no router. `App.tsx` is a thin view shell
  (`view: 'library' | 'import'`); add a `'settings'` view and a Sidebar entry the
  same way "Import files" toggles in.
- **Possible related settings to fold in later:** default sort, thumbnail size,
  theme — keep the page structured to grow.

## 2. Quick view buttons (top / left / right / bottom / front / back / iso)

Buttons in the detail viewer that snap the camera to an orthographic-style
preset orientation, in addition to free orbit.

- **The framing primitive already exists:** `frameCameraToBox(camera, target, box, direction)`
  in `frontend/src/lib/viewerModes.ts` takes a viewing `direction` — quick views are
  just axis-aligned directions:
  - Top `(0, 1, 0)`, Bottom `(0, -1, 0)`, Front `(0, 0, 1)`, Back `(0, 0, -1)`,
    Left `(-1, 0, 0)`, Right `(1, 0, 0)`, Iso = default `(1, 0.9, 1)`.
- **Wiring:** `ModelViewer` currently re-frames only when the visible set changes
  (keyed on `visibleIndices` via `frameKeyRef`). To honor a chosen preset, add a
  `viewDirection` prop (or an imperative handle) so a button press re-frames the
  *current* visible bounds from the requested direction. Reuse `boundsForObjects` /
  `model.bounds` exactly as the existing re-frame effect does.
- **UI placement:** a small control group near `ViewerModeToggle` in `DetailView`
  (`frontend/src/views/DetailView.tsx`), consistent with the filmstrip / mode toggle.
- **Note:** these are orientation presets on the existing perspective camera; true
  orthographic projection would be a separate, larger change.

## 3. Download files from the database + default download directory setting

Let a user download the stored source file(s) for a model out of the database to
disk, and add a "default download directory" preference to the Settings page.

- **Download action:** new API endpoint that streams the stored file bytes back
  (e.g. `GET /api/files/{id}/download` returning the original 3MF/STL blob with an
  appropriate `Content-Disposition` filename). Frontend triggers it from the detail
  view / library context menu.
- **Default download directory setting:** folds into the Settings page from item #1.
  - *Browser context:* the browser controls where downloads land; a "default
    directory" is only enforceable via the File System Access API (`showSaveFilePicker`
    / a chosen directory handle) or by the Docker/desktop host, not plain `<a download>`.
    Decide during brainstorming whether this is a true default dir or just a
    remembered "last used" hint.
  - Store alongside the other settings (see item #1's client-vs-backend decision).
- **Bulk download:** consider zipping multiple selected files server-side for a
  single download.

## 4. Update / replace 3MF/STL files on an existing model

Allow replacing the stored 3MF/STL geometry for an existing record (re-upload a
newer version) without losing the model's metadata, folders, or collections.

- **Re-upload flow:** an "update file" action that accepts a new 3MF/STL and swaps
  the stored blob while keeping the same model id and its associations.
- **Re-derive on replace:** thumbnails, bounds, and any parsed geometry metadata
  need regenerating for the new file — reuse the existing import/parse pipeline
  rather than duplicating it.
- **Versioning — decide during brainstorming:** overwrite in place vs. keep prior
  versions (history / rollback). Overwrite is simpler; version history is a larger
  concept touching the data model.

## 5. Folder cover images

Let a folder have a cover image, and display it somewhere in the UI. Explicitly
deferred out of Phase 8 (folder management) because covers are currently displayed
nowhere, so building the picker/upload would be "set but never shown."

- **Backend already half-supports it:** the `Folder` entity has a `CoverImageFile`
  relation, and `PUT /api/folders/{id}` accepts `CoverImageFileId` (points the cover
  at an existing file's thumbnail). No arbitrary-image upload endpoint exists yet.
- **Two levels of ambition (decide during brainstorming):**
  - *Pick from folder's files:* cover picker shows thumbnails of files in the folder
    (+ descendants); reuses existing `CoverImageFileId` — no new backend.
  - *Custom upload:* a "+ Upload" tile per the Screen 6a mockup — needs a new endpoint
    to store/serve an arbitrary cover image blob, plus cleanup on folder delete.
- **Prerequisite — give covers a home first:** decide where a cover actually renders
  (e.g. a thumbnail next to the folder name in the library Sidebar, or a folder
  header). The feature only earns its keep once it's displayed.
- **Original design intent:** Screen 6a (project-overview Phase 8) specced a right-panel
  cover picker with auto-suggested file thumbnails + a "+ Upload" tile.

## 6. Accessible folder drag-and-drop (keyboard + screen reader)

Phase 8 folder management uses **native HTML5 drag-and-drop** for reorder/re-nest,
which is mouse/pointer-only and not keyboard- or screen-reader-accessible. Add an
accessible path when a11y becomes a priority.

- **Gap:** HTML5 `draggable`/`onDrop` has no keyboard equivalent and no SR
  announcements. A keyboard user currently cannot move a folder.
- **Options when picked up:**
  - *Menu-driven fallback:* add a "Move to…" context-menu action opening a parent
    picker (like `AssignFoldersModal`) + "Move up/down" — fully keyboard-accessible,
    no new dependency. Lowest-effort way to close the gap.
  - *Accessible DnD library (`@dnd-kit`):* built-in keyboard sensors + SR
    announcements, but it's the first heavy frontend dependency and still needs a
    hand-written sortable-tree (nesting) layer. Considered and set aside in Phase 8
    brainstorming.
- **Also revisit:** visible focus states and ARIA roles on the editable Sidebar tree.

## 7. Phase 8 Sidebar polish (from code review)

Non-blocking nits logged during the Phase 8 folder-management reviews. All small;
touch when the Sidebar is next edited (`frontend/src/components/Sidebar.tsx` /
`Sidebar.module.css`).

**Resolved 2026-07-12** (`phase-8-folder-management`): the eight items below were
addressed in one pass, with new Sidebar tests for the two behavioral fixes and the
menu-dismissal changes. The remaining test-infra item stays open.

- ~~**Extract a shared `commitMove(items)` helper.**~~ Done — `handleDrop` and
  `handleRootDrop` now compute their items and delegate to one `commitMove` (which also
  covers the `reloadFiles()` fix below).
- ~~**Dead `draggable` RowProp.**~~ Done — removed the unused prop from `RowProps`, the
  recursion, and both call sites; dropped the no-op `e.stopPropagation()` in `onDragStart`.
- ~~**Stale `actionError` after a no-op drop.**~~ Done — `onDragStartRow` clears the error
  when a new drag begins.
- ~~**No `onDragLeave` on rows.**~~ Done — rows clear their drop indicator on
  `onDragLeave` (guarded against inner-child flicker via a `relatedTarget` containment check).
- ~~**Double padding inset.**~~ Done — `.rowMain` padding zeroed so `.row` owns the inset.
- ~~**Context menu dismissal is `onMouseLeave`-only.**~~ Done — `openMenuId` lifted to the
  Sidebar (single menu open at a time); dismisses on outside click and Escape.
- ~~**Delete confirm dialog a11y.**~~ Done — body paragraph given an id, tied via
  `aria-describedby` on the dialog.
- ~~**Re-nest doesn't `reloadFiles()`.**~~ Done — `commitMove` reloads files as well as
  folders.
- ~~**`handleDrop` before/after zone detection is only human-verified.**~~ Done
  (2026-07-12) — added Sidebar-level tests for the `before`/`after` zones. jsdom has no
  `DragEvent` (testing-library falls back to a plain `Event` that drops `clientY`) and
  `getBoundingClientRect()` returns a zero rect, so the tests mock the row's rect and set
  `clientY` on the event by hand to hit the top/bottom zone thresholds. The two assertions
  keep Gamma at root with distinct sort orders (0 vs 1), proving the branch actually fired
  rather than falling back to `onto`.

## 8. Tag management (rename / recolor / delete)

Tags can currently only be *created* (`POST /api/tags`, inline during import or in the
batch panel). There's no way to rename a tag, change its color, or delete one. Now that
the Sidebar has a first-class **Tags** section (Collections + Tags model, merged 2026-07-12),
that's the natural home for management. Explicitly a non-goal of that spec.

- **Backend:** `TagsController` only has `Create` today. Add `PUT /api/tags/{id}`
  (rename + `ColorKey`) and `DELETE /api/tags/{id}`. Delete must remove the tag's
  `FileTag` join rows then `PurgeDeletedObjects()` (XPO `Session` rules — no
  `CommitTransaction()` without `BeginTransaction()`; purge after deletes — see project
  memory). The `Tag` entity is just `Name` + `ColorKey`.
- **Frontend:** reuse the Sidebar folder patterns — right-click context menu
  (Rename/Delete) + inline rename + `ConfirmDialog` — on the Tags rows
  (`frontend/src/components/Sidebar.tsx`). Add `updateTag`/`deleteTag` to
  `frontend/src/api/client.ts` and a `reload()` to `useTags` (it has none yet).
  Color editing needs a small picker; today tag colors just cycle orange/green/red/brass
  via `tagColor` in `frontend/src/lib/format.ts` — decide the palette during brainstorming.
- **Filter cleanup on delete:** `LibraryView.selectedTagIds` must drop a removed tag id
  so the grid doesn't keep filtering on a ghost tag (and its toolbar chip disappears).
- **Optional (larger):** merge two tags into one — reassigns every `FileTag` from the
  losing tag to the winner, then deletes the loser.
