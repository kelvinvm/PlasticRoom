# Handoff: 3D Printer File Organizer

## Overview
A web app for organizing 3MF/STL 3D-printer files — think Lightroom Classic, but for print files instead of photos. Core capabilities: browse a library of files with embedded 3D previews, organize files into an unlimited-depth nested folder tree (a file can live in many folders/collections at once, not just one), view a single file in detail with an embedded 3D viewer and technical metadata, import new files with automatic metadata parsing, batch-tag/assign multiple files at once, and manage the folder tree itself (create/rename/nest/reorder/delete, with per-folder description + cover image).

## About the Design Files
The bundled file (`design_reference.dc.html`) is a **design reference built in HTML** — it is a set of static, non-interactive mockups showing intended look, layout, and behavior. It is **not production code to copy directly**. Your task is to **recreate these designs in the target codebase's existing environment** (React, Vue, etc.) using its established component patterns, state management, and libraries — or, if no frontend environment exists yet, choose the most appropriate modern web framework (React + TypeScript is a safe default for this kind of dense, stateful desktop-class app) and implement the designs there.

The file opens directly in any browser — open it to see every screen, scroll/pan/zoom around the canvas. Each screen is labeled with an id badge (e.g. `1a`, `6a`) referenced throughout this doc.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy below are final — recreate pixel-close using the codebase's existing UI primitives where they fit, falling back to the values in the Design Tokens section otherwise.

## Screens / Views

### 1. Main Library (chosen direction: `1a` — Classic three-pane)
**Purpose:** Primary browsing screen — the home view of the app.
**Layout:** Three fixed-width columns in a flex row, full viewport height.
- **Left sidebar** (220px, `#151210` bg, right border `1px solid rgba(255,255,255,.08)`): app logo/name header (padding 16px), then two scrollable sections — "LIBRARY" (the folder tree, indented 14px per nesting level, each row 6-8px vertical padding) and "COLLECTIONS" (flat list: Favorites, Printed, To Print, Failed Prints — icon + label). The active/selected folder row gets `background: rgba(255,138,61,.15)`, text color `#ff8a3d`, font-weight 600.
- **Center** (flex:1): top toolbar (14px/20px padding, border-bottom) showing current folder name, file count, and a search input (right-aligned, 200×30px, `#1f1b17` bg, 6px radius). Below it, a scrollable CSS grid of file cards, `grid-template-columns: repeat(4, 1fr)`, 16px gap, 18-20px padding.
  - **File card**: `#1c1815` bg, `1px solid rgba(255,255,255,.08)` border, 9px radius, overflow hidden. Top: thumbnail, `aspect-ratio: 4/3`, striped placeholder background (see Assets), centered "3MF PREVIEW"/"STL PREVIEW" label in 11px IBM Plex Mono at 30% opacity white. Bottom: 10-12px padding — file name (600 weight, 12.5px, IBM Plex Sans, single-line ellipsis), one-line description (11px, 45% opacity, margin 4px 0 6px), then a row of tag pills (10px Plex Mono, pill radius 99px, padding 2-7px, color-coded — see Design Tokens). Selected card gets `box-shadow: 0 0 0 2px #ff8a3d`.
- **Right sidebar** (280px, `#151210` bg, left border): selected file's detail panel — large thumbnail (aspect 4/3, 8px radius), file name + "size · added date" metadata line, a stack of label/value rows (Dimensions, Est. print time, Material — value in IBM Plex Mono, right-aligned), a divider, Description block, and "In folders / collections" section showing tag pills plus a dashed "+ add" pill that opens the multi-assign panel (see Screen 3).

### 2. Single-file detail view (`2a`)
**Purpose:** Full-screen focus view for one file — the embedded 3D viewer plus complete metadata/editing.
**Layout:** Two columns.
- **Left** (flex:1): breadcrumb bar (folder path › file name, 13px), a large embedded 3D viewer area (`radial-gradient(circle at 50% 40%, #241f1a, #131010)` background, centered striped placeholder standing in for the actual rendered model, "DRAG TO ORBIT · SCROLL TO ZOOM" hint text), a top-right segmented control (Solid / Wireframe / Plates — active segment `#ff8a3d` bg with dark text, inactive `#1f1b17` bg with border), and a bottom filmstrip (96px tall) of plate thumbnails when the file has multiple plates (3MF can contain several build plates) — active plate gets the orange ring.
- **Right** (320px, `#151210` bg): file name (700/15px) + size/date, then sections in order: SPECS (label/value rows: Dimensions, Est. print time, Material, Layer height, Plates), DESCRIPTION (editable text block, `#1f1b17` bg, 8px radius), IN FOLDERS/COLLECTIONS (tag pills + add affordance, same pattern as the library sidebar).

### 3. Folder/collection multi-assign panel (`3a`)
**Purpose:** Modal/panel for checking a single file into any number of tree nodes at once — this is the mechanism that lets one file belong to many folders simultaneously.
**Layout:** Modal card, 760px wide. Header: file thumbnail (36×36, 6px radius) + "Add '{filename}' to folders" title + helper subtext explaining multi-check behavior. Body: the full folder tree rendered as checkboxes (not radio buttons) — each row has a 16×16px checkbox (checked = solid `#ff8a3d` bg with white checkmark; unchecked = `1.5px solid rgba(242,237,228,.3)` outline), an expand/collapse chevron for parents, and the folder name, indented 22px per depth level. Checked rows also get a subtle `rgba(255,138,61,.12)` row background. Footer: "+ New folder" link (left), Cancel + "Save (n)" buttons (right) where n = count of newly checked nodes.

### 4. Batch tagging (`4a`)
**Purpose:** Apply folder/collection assignment and tags to multiple selected files in one action.
**Layout:** Two columns.
- **Left** (flex:1): toolbar showing "{n} files selected of {total}". Below, the same 4-column file-card grid as the library, but selected cards get the orange selection ring plus a small checkmark badge (20×20px, `#ff8a3d` bg, top-left corner, 5px radius) — unselected cards in the same view are dimmed to 50% opacity to emphasize the active selection.
- **Right** (300px, `#151210` bg): "Batch actions" header, then "ADD TO FOLDER/COLLECTION" search input + resulting pills (with ✕ to remove before applying), "TAGS" search input + pills, then Cancel / "Apply to {n}" buttons pinned to the bottom.

### 5. Import flow (`5a`)
**Purpose:** Drag in new 3MF/STL files, review auto-parsed metadata, and assign destination folders/tags before committing the import.
**Layout:** Header bar: "Import files" title + "{n} detected · {n} ready" status. Below, two columns.
- **Left** (flex:1, scrollable): a dashed drop-zone banner at the top (`2px dashed rgba(255,138,61,.35)`, `rgba(255,138,61,.05)` bg, 12px radius, 22px padding) with a down-arrow icon chip and "Drop 3MF / STL files here, or click to browse" copy, subtext explaining that dimensions/print time/plates are auto-parsed. Below it, a vertical list of detected files as compact rows (44×44px thumbnail, filename, a metadata line in IBM Plex Mono showing parsed dimensions/print-time/file-size, and a status chip — `✓ parsed` in green `#3ddc97`, or `✕ error` in red `#e0654a` with an explanatory line replacing the metadata line and the row bordered in translucent red for files that failed to parse).
- **Right** (300px, `#151210` bg): "ADD ALL TO FOLDER(S)" search + pills, "TAGS FOR ALL" search, a small warning note when some files failed parsing ("1 file couldn't be parsed and will be skipped…"), and Cancel / "Import {n} files" buttons at the bottom (count excludes failed files).

### 6. Folder management screen (`6a`)
**Purpose:** Dedicated screen for editing the folder tree itself — create, rename, re-nest via drag, reorder, delete, and set per-folder description + cover image.
**Layout:** Two columns.
- **Left** (340px, `#151210` bg): header with "Manage folders" title + "+ New folder" button (`#ff8a3d` bg). Below, the full tree with a drag handle (⠿ glyph, grab cursor) on every row, expand/collapse chevrons, indentation per depth (22px/level), and a right-aligned file count per folder in IBM Plex Mono. Selected folder row highlighted the same orange-tint way as elsewhere. Footer hint: "Drag ⠿ to reorder or re-nest. Right-click for more options."
- **Right** (flex:1): selected folder's editable detail — cover thumbnail + name/breadcrumb + counts header, then editable "FOLDER NAME" field, editable "DESCRIPTION" textarea, "COVER IMAGE" — a row of candidate cover thumbnails auto-suggested from files inside the folder (first one marked "AUTO" and ring-highlighted as the current cover) plus an "+ Upload" dashed tile, a divider, then action row: "Save changes" (primary, orange), "Move to…" (secondary, outlined), "Delete folder" (destructive, red text/border, pushed right).

## Interactions & Behavior
- **Navigation:** Left tree (screens 1, 6) is the primary nav — clicking a folder filters the center grid to files in that folder (files assigned to a folder OR any of its descendants, TBD — confirm with product). Clicking a file card opens the detail view (screen 2). Breadcrumb in screen 2 navigates back up the tree.
- **Selection:** Click = select one file (updates right-hand detail panel, screen 1). Cmd/Ctrl-click or Shift-click = multi-select, which should surface a batch action bar/panel (screen 4) once ≥2 files are selected.
- **Multi-assign:** The "+ add" pill (screens 1, 2) opens the checkbox tree modal (screen 3). Checking/unchecking a node is instant (no separate "add" step) but the Save button commits the diff to whatever is unchecked as well — model this as a working set of folder-ids that gets diffed against the file's current folder-ids on Save.
- **Drag and drop:**
  - Folder tree (screen 6): drag the ⠿ handle to reorder siblings or re-parent (drop onto another folder row to nest inside it — show a drop-target highlight).
  - Import (screen 5): native OS drag-and-drop of files onto the drop zone triggers parsing; also clickable to open a file picker.
- **Import parsing:** On drop/select, each file is queued, parsed (extract dimensions, estimated print time, plate count, file size), and rendered as a row with `✓ parsed`. Files that fail to parse show `✕ error` and are excluded from the final import count/action — the user should still be able to import the successful ones.
- **Batch apply:** Adding a folder/tag pill in the right panel (screens 4, 5) stages it; nothing is written until "Apply"/"Import" is pressed. Removing a staged pill (✕) un-stages it.
- **Viewer controls (screen 2):** drag to orbit, scroll to zoom (standard 3D viewer gesture set — implement with a library like three.js + OrbitControls). Solid/Wireframe/Plates is a segmented toggle that changes the render mode of the same model. For 3MF files with multiple plates, the filmstrip switches which plate is shown; STL files (single mesh, no plate concept) should hide the filmstrip entirely.
- **Empty/loading states not yet designed** — flag these as gaps: empty folder, empty library (first run), viewer loading spinner while a large file parses. Recommend the developer follow the existing visual language (dark surfaces, orange accent, Plex Mono for status text) if these are needed before further design passes.

## State Management
Suggested state shape (adapt to the codebase's existing patterns):
- `folders`: tree structure, each node `{ id, name, parentId, description, coverImageId, order }` — since a file can belong to multiple folders, folder membership is NOT stored on the folder node; model it as a many-to-many join.
- `files`: flat list, each `{ id, name, type: '3mf'|'stl', sizeBytes, addedAt, dimensions, estPrintTimeMin, material, layerHeightMm, plateCount, description, thumbnailUrl }`.
- `fileFolders`: many-to-many join table/array, `{ fileId, folderId }` — this is what powers multi-assign (screen 3) and folder filtering (screens 1, 6).
- `tags`: simple flat list of tag strings (or `{id, name, colorKey}` if tags get their own colors long-term) attached to files, also many-to-many.
- `selection`: currently selected file id (single) or set of ids (multi/batch mode).
- `activeFolderId`: which tree node is filtering the center grid.
- `importQueue`: transient state for screen 5 — array of `{ file, parseStatus: 'pending'|'parsed'|'error', parsedMeta, errorMessage }`, plus staged `folderIds`/`tags` to apply on commit.
- Data fetching: none specified — this can be a local-first app (files live on the user's disk/local DB) or backed by an API; not enough detail was given to spec this further. Ask the user/product if files are expected to sync across devices.

## Design Tokens

### Colors
- Background (app shell): `#0f0e0c`
- Background (panel, e.g. sidebars): `#151210`
- Background (surface, e.g. cards, inputs): `#1c1815` / `#1f1b17` / `#17140f` (used interchangeably for slightly-elevated surfaces — consolidate to one value in implementation)
- Border (default): `rgba(255,255,255,.08)` — `rgba(255,255,255,.1)` on some cards
- Text primary: `#f2ede4`
- Text secondary: `rgba(242,237,228,.5)` to `.65`
- Text tertiary/placeholder: `rgba(242,237,228,.3)` to `.4`
- Accent (primary, interactive/selected): `#ff8a3d` (orange) — text-on-accent uses `#1a1512`
- Accent tint (selected row/card bg): `rgba(255,138,61,.12)` to `.15`
- Secondary tag color (brass/amber, for variety in tag pills): `#dbb55a`, tint `rgba(219,181,90,.15)`
- Success (parsed OK): `#3ddc97`
- Error/destructive: `#e0654a`

### Typography
- UI text: **IBM Plex Sans** (400/500/600/700) — via Google Fonts.
- Technical/numeric readouts (dimensions, print time, file size, tag pills, status labels): **IBM Plex Mono** (400/500/600) — via Google Fonts.
- Sizes in use: 26px (page title), 18px (section title), 14-15px (panel titles), 12.5-13px (body/labels), 11-12px (secondary text), 9.5-11px (tag pills, mono readouts).

### Spacing / Radius / Shadow
- Card radius: 9-12px. Pill radius: 99px (fully rounded). Button radius: 7px. Small chip radius: 5-6px.
- Card shadow: `0 8px 24px rgba(0,0,0,.4)` (used on elevated design-doc cards; app surfaces are mostly flat with borders instead of shadows).
- Selection ring: `box-shadow: 0 0 0 2px #ff8a3d`.
- Grid gap: 16-20px depending on density. Panel padding: 16-24px.

## Assets
- **3D thumbnails/renders**: all placeholders in the reference file — a repeating diagonal-stripe CSS gradient (`repeating-linear-gradient(135deg, #241f1a, #241f1a 8px, #2b241e 8px, #2b241e 16px)`) standing in for real parsed-model thumbnails/renders. The developer needs a real 3MF/STL thumbnail generator (server-side render or client-side three.js snapshot) and a real embedded 3D viewer (three.js + OrbitControls, or similar) for screen 2 — these do not exist yet and are the biggest build item not covered by static HTML.
- **Icons**: current mockups use plain emoji/glyphs (📁, ★, ⠿, ▾, ✓, ✕) as stand-ins. Replace with a proper icon set matching the codebase's existing icon library.
- **Fonts**: IBM Plex Sans + IBM Plex Mono, loaded from Google Fonts in the reference file's `<head>`.

## Files
- `design_reference.dc.html` — all 6 screens (each screen/option is labeled with a visible id badge like `1a`, `6a` you can reference back to this README). Open directly in a browser; pan/zoom to see every screen on one canvas.
- `screenshots/` — static PNG captures of each screen, for quick reference without opening the HTML:
  - `1a-library-classic-three-pane.png` / `1b-library-grid-first.png` / `1c-library-workbench-viewer.png` — the three main-library layout directions (1a is the chosen base)
  - `2a-file-detail-view.png` — single-file detail view
  - `3a-folder-multiassign.png` — folder/collection multi-assign panel
  - `4a-batch-tagging.png` — batch tagging
  - `5a-import-flow.png` — import flow
  - `6a-folder-management.png` — folder management screen
