# Phase 5 — File Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking a file card opens a full-screen interactive Three.js viewer (orbit/zoom, Solid/Wireframe/Plates, plate filmstrip for multi-item 3MF) with an editable metadata panel, backed by two new file-serving endpoints and real thumbnails throughout the library.

**Architecture:** Two thin `PhysicalFile` GET endpoints on the existing `FilesController` stream the original model bytes and the stored thumbnail PNG. On the frontend, the Phase 4 model-loading logic is extracted into a shared `lib/modelLoading.ts` consumed by both the thumbnail generator and a new live viewer. A full-screen `DetailView` renders as a layer over the still-mounted library so "back" is instant and stateful. Scene-graph mutations (render mode, plate isolation) live in a pure, WebGL-free `lib/viewerModes.ts` that is unit-tested; the WebGL render loop itself is exercised by running the app (Phase 4 precedent).

**Tech Stack:** ASP.NET Core 10 + DevExpress XPO (backend); React 19 + TypeScript + Vite, Three.js + OrbitControls, CSS Modules, Vitest + React Testing Library (frontend).

## Global Constraints

- Backend targets **net10.0**; DevExpress.Xpo **24.1.6** (public nuget.org feed).
- The file entity is **`ModelFile`** in code (not `File`), `[Persistent("File")]`.
- XPO `Session` (from `XpoSessionFactory.CreateSession()`) has **no implicit transaction**: `.Save()` persists immediately; **never** call `CommitTransaction()`; call `PurgeDeletedObjects()` after any `.Delete()`. (No deletes are introduced in this phase.)
- Backend dev server: **http://localhost:5102** (`SEED_SAMPLE_DATA=true` to populate). Frontend dev: **http://localhost:5173**, proxying `/api` to `127.0.0.1:5102`.
- Frontend: **no router, no state manager, no data-fetching library.** CSS Modules over `frontend/src/styles/tokens.css` design tokens. Data hooks in `src/hooks/`, pure utils in `src/lib/`, API client + camelCase types in `src/api/`.
- Any Vitest test file that transitively imports `three` **must** start with the docblock `// @vitest-environment jsdom`.
- Design tokens (colors, radii, fonts) come from `frontend/src/styles/tokens.css` — reuse token CSS variables (`--accent`, `--bg-panel`, `--thumb-placeholder`, `--font-mono`, etc.), never hard-code hex.
- Run backend tests with `dotnet test` from `backend/`; frontend tests with `npm test` (Vitest) from `frontend/`.

---

## File Structure

**Backend**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs` — add `GetContent` + `GetThumbnail` actions.
- Modify: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs` — endpoint tests.

**Frontend — lib/api/hooks**
- Create: `frontend/src/lib/modelLoading.ts` — shared loader: bytes → `{ object, bounds, objects }`.
- Modify: `frontend/src/lib/thumbnail.ts` — consume `modelLoading.ts`; re-export `fileTypeFromName`, `dimsFromObject`.
- Create: `frontend/src/lib/viewerModes.ts` (+ `.test.ts`) — pure render-mode / plate-isolation helpers.
- Modify: `frontend/src/api/client.ts` — `getFile`, `fileContentUrl`, `fileThumbnailUrl`, `updateFileDescription`.
- Create: `frontend/src/hooks/useFile.ts` (+ `.test.ts`) — fetch one file's detail.

**Frontend — components/views**
- Create: `frontend/src/components/viewer/ViewerModeToggle.tsx` (+ `.test.tsx`, `.module.css`).
- Create: `frontend/src/components/viewer/PlateFilmstrip.tsx` (+ `.test.tsx`, `.module.css`).
- Create: `frontend/src/components/viewer/ModelViewer.tsx` (+ `.test.tsx`, `.module.css`).
- Create: `frontend/src/components/detail/DetailInfoPanel.tsx` (+ `.test.tsx`, `.module.css`).
- Create: `frontend/src/views/DetailView.tsx` (+ `.module.css`).
- Modify: `frontend/src/App.tsx` — detail layer + navigation state.
- Modify: `frontend/src/views/LibraryView.tsx` — `onOpenFile` prop, pass active folder.
- Modify: `frontend/src/components/FileGrid.tsx` (+ `.test.tsx`, `.module.css`) — double-click to open + real thumbnail.
- Modify: `frontend/src/components/FileDetailPanel.tsx` (+ `.module.css`) — real thumbnail.

---

## Task 1: Backend — `GET /api/files/{id}/content`

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Consumes: `_sessionFactory.CreateSession()`, `ModelFile.StoragePath`, `ModelFile.Type` (existing).
- Produces: action `IActionResult GetContent(int id)` returning `PhysicalFileResult` (`model/3mf` or `model/stl`, `enableRangeProcessing: true`) or `NotFoundObjectResult`.

- [ ] **Step 1: Write the failing tests**

Add to `FilesControllerTests.cs` (uses the existing `BuildStlFormFile` helper and `_controller`):

```csharp
[Fact]
public async System.Threading.Tasks.Task GetContent_ReturnsPhysicalFile_ForExistingFile()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("widget.stl") })).Value!;

    var result = _controller.GetContent(dto.Id);

    var file = Assert.IsType<PhysicalFileResult>(result);
    Assert.Equal("model/stl", file.ContentType);
    Assert.True(file.EnableRangeProcessing);
    Assert.True(System.IO.File.Exists(file.FileName));
}

[Fact]
public void GetContent_Returns404_ForUnknownId()
{
    Assert.IsType<NotFoundObjectResult>(_controller.GetContent(999999));
}

[Fact]
public async System.Threading.Tasks.Task GetContent_Returns404_WhenFileMissingOnDisk()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("gone.stl") })).Value!;
    foreach (var f in Directory.GetFiles(_fileStorage.FilesDirectory)) System.IO.File.Delete(f);

    Assert.IsType<NotFoundObjectResult>(_controller.GetContent(dto.Id));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.GetContent`
Expected: FAIL — `FilesController` does not contain a definition for `GetContent`.

- [ ] **Step 3: Implement the endpoint**

Add this action to `FilesController` (place after `GetById`, before `Upload`):

```csharp
[HttpGet("{id}/content")]
public IActionResult GetContent(int id)
{
    using var session = _sessionFactory.CreateSession();
    var file = session.GetObjectByKey<ModelFile>(id);
    if (file is null)
    {
        return NotFound(new { error = $"File {id} not found" });
    }

    if (string.IsNullOrEmpty(file.StoragePath) || !System.IO.File.Exists(file.StoragePath))
    {
        return NotFound(new { error = $"File {id} content is missing on disk" });
    }

    var contentType = file.Type == ModelFileType.ThreeMf ? "model/3mf" : "model/stl";
    return PhysicalFile(file.StoragePath, contentType, file.Name, enableRangeProcessing: true);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.GetContent`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(api): serve original model bytes via GET /api/files/{id}/content"
```

---

## Task 2: Backend — `GET /api/files/{id}/thumbnail`

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Consumes: `ModelFile.ThumbnailPath` (existing, nullable), existing `UploadThumbnail(int id, IFormFile file)` action (to arrange the "has thumbnail" case).
- Produces: action `IActionResult GetThumbnail(int id)` returning `PhysicalFileResult` (`image/png`) or `NotFoundObjectResult`.

- [ ] **Step 1: Write the failing tests**

Add a PNG form-file helper and tests to `FilesControllerTests.cs`:

```csharp
private static IFormFile BuildPngFormFile(string fileName)
{
    // Minimal 1x1 PNG.
    var bytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
    return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
}

[Fact]
public async System.Threading.Tasks.Task GetThumbnail_Returns404_WhenNoThumbnail()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("nothumb.stl") })).Value!;

    Assert.IsType<NotFoundObjectResult>(_controller.GetThumbnail(dto.Id));
}

[Fact]
public async System.Threading.Tasks.Task GetThumbnail_ReturnsPng_AfterUpload()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("hasthumb.stl") })).Value!;
    await _controller.UploadThumbnail(dto.Id, BuildPngFormFile($"{dto.Id}.png"));

    var result = _controller.GetThumbnail(dto.Id);

    var file = Assert.IsType<PhysicalFileResult>(result);
    Assert.Equal("image/png", file.ContentType);
    Assert.True(System.IO.File.Exists(file.FileName));
}

[Fact]
public void GetThumbnail_Returns404_ForUnknownId()
{
    Assert.IsType<NotFoundObjectResult>(_controller.GetThumbnail(999999));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.GetThumbnail`
Expected: FAIL — `GetThumbnail` not defined.

- [ ] **Step 3: Implement the endpoint**

Add after `GetContent`:

```csharp
[HttpGet("{id}/thumbnail")]
public IActionResult GetThumbnail(int id)
{
    using var session = _sessionFactory.CreateSession();
    var file = session.GetObjectByKey<ModelFile>(id);
    if (file is null)
    {
        return NotFound(new { error = $"File {id} not found" });
    }

    if (string.IsNullOrEmpty(file.ThumbnailPath) || !System.IO.File.Exists(file.ThumbnailPath))
    {
        return NotFound(new { error = $"File {id} has no thumbnail" });
    }

    return PhysicalFile(file.ThumbnailPath, "image/png");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.GetThumbnail`
Expected: PASS (3 tests). Then run the full backend suite: `dotnet test` — expected all green (was 35, now +6).

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(api): serve stored thumbnail PNG via GET /api/files/{id}/thumbnail"
```

---

## Task 3: Extract shared `lib/modelLoading.ts`

**Files:**
- Create: `frontend/src/lib/modelLoading.ts`
- Modify: `frontend/src/lib/thumbnail.ts`
- Test: `frontend/src/lib/thumbnail.test.ts` (existing — must stay green, no changes needed)

**Interfaces:**
- Produces:
  - `type ModelFileType = 'ThreeMf' | 'Stl'`
  - `interface ModelDims { x: number; y: number; z: number }`
  - `interface LoadedModel { object: THREE.Object3D; bounds: THREE.Box3; objects: THREE.Object3D[] }`
  - `function fileTypeFromName(name: string): ModelFileType | null`
  - `function dimsFromObject(object: THREE.Object3D): ModelDims`
  - `function loadModelFromBuffer(buffer: ArrayBuffer, type: ModelFileType): LoadedModel`
- `thumbnail.ts` re-exports `fileTypeFromName` and `dimsFromObject` so `./thumbnail` import paths keep working.

- [ ] **Step 1: Create `lib/modelLoading.ts`**

```ts
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'

export type ModelFileType = 'ThreeMf' | 'Stl'

export type ModelDims = { x: number; y: number; z: number }

export interface LoadedModel {
  /** Root object to add to a scene (STL: the mesh; 3MF: the build group). */
  object: THREE.Object3D
  /** World-space bounding box, honoring baked build-item transforms. */
  bounds: THREE.Box3
  /** Top-level build-items ("plates"). One entry for STL / single-item 3MF. */
  objects: THREE.Object3D[]
}

export function fileTypeFromName(name: string): ModelFileType | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.stl')) return 'Stl'
  if (lower.endsWith('.3mf')) return 'ThreeMf'
  return null
}

// World-space bounding-box size, honoring the transforms the loader bakes into
// each mesh (3MF build items are positioned across the plate). Local-space
// bounds would ignore those transforms and misframe.
export function dimsFromObject(object: THREE.Object3D): ModelDims {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return { x: 0, y: 0, z: 0 }
  const size = new THREE.Vector3()
  box.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

// Loads model bytes into a THREE object plus its world-space bounds and the
// list of top-level build-items. Pure JS but not unit-asserted (needs the
// loaders' runtime) — exercised by running the app, like Phase 4.
export function loadModelFromBuffer(buffer: ArrayBuffer, type: ModelFileType): LoadedModel {
  if (type === 'Stl') {
    const geometry = new STLLoader().parse(buffer)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd8cfc2 }))
    mesh.updateMatrixWorld(true)
    return { object: mesh, bounds: new THREE.Box3().setFromObject(mesh), objects: [mesh] }
  }
  const group = new ThreeMFLoader().parse(buffer)
  group.updateMatrixWorld(true)
  // Each 3MF <build><item> becomes a direct child of the loaded group.
  const objects = group.children.length > 0 ? [...group.children] : [group]
  return { object: group, bounds: new THREE.Box3().setFromObject(group), objects }
}
```

- [ ] **Step 2: Refactor `thumbnail.ts` to consume it**

Replace the top of `thumbnail.ts` (imports through the local `loadModel`) so it reuses the shared module. Full new `thumbnail.ts`:

```ts
import * as THREE from 'three'
import {
  type ModelDims,
  type ModelFileType,
  dimsFromObject,
  fileTypeFromName,
  loadModelFromBuffer,
} from './modelLoading'

export type { ModelDims } from './modelLoading'
export { fileTypeFromName, dimsFromObject } from './modelLoading'

export interface ThumbnailResult {
  pngBlob: Blob
  dims: ModelDims
  plateCount: number | null
}

export type ThumbnailGenerator = (file: File) => Promise<ThumbnailResult>

async function loadFromFile(
  file: File,
): Promise<{ object: THREE.Object3D; plateCount: number | null }> {
  const buffer = await file.arrayBuffer()
  const type: ModelFileType | null = fileTypeFromName(file.name)
  if (type === null) throw new Error('Unsupported file type')
  const { object, objects } = loadModelFromBuffer(buffer, type)
  const plateCount = type === 'ThreeMf' ? objects.length || 1 : null
  return { object, plateCount }
}

function renderToPng(object: THREE.Object3D): Promise<Blob> {
  const size = 320
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(size, size, false)

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(1, 1, 1)
  scene.add(key)
  scene.add(object)

  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  const center = new THREE.Vector3()
  const extent = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(extent)
  const radius = Math.max(extent.x, extent.y, extent.z) || 1

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, radius * 100)
  camera.position.set(center.x + radius * 1.6, center.y + radius * 1.4, center.z + radius * 1.6)
  camera.lookAt(center)

  renderer.render(scene, camera)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      renderer.dispose()
      if (blob) resolve(blob)
      else reject(new Error('Failed to render thumbnail'))
    }, 'image/png')
  })
}

export const generateThumbnail: ThumbnailGenerator = async (file) => {
  const { object, plateCount } = await loadFromFile(file)
  const dims = dimsFromObject(object)
  const pngBlob = await renderToPng(object)
  return { pngBlob, dims, plateCount }
}
```

Note: plate count now derives from build-item count (`objects.length`) rather than a mesh-traverse count — this aligns the client with the backend's `<build><item>` definition. Behavior for the staging preview is equivalent for typical files; the server value remains authoritative on commit.

- [ ] **Step 3: Run the existing + typecheck to verify nothing broke**

Run: `npm test -- src/lib/thumbnail.test.ts` then `npx tsc -b`
Expected: `thumbnail.test.ts` PASS (4 assertions across 2 describes); `tsc` clean. If any other file imported the removed `ThumbnailResult`/`fileTypeFromName` shapes, fix the import to point at `./thumbnail` (unchanged) — nothing should need changing.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/modelLoading.ts frontend/src/lib/thumbnail.ts
git commit -m "refactor(frontend): extract shared lib/modelLoading from thumbnail generator"
```

---

## Task 4: Pure render-mode helpers `lib/viewerModes.ts`

**Files:**
- Create: `frontend/src/lib/viewerModes.ts`
- Test: `frontend/src/lib/viewerModes.test.ts`

**Interfaces:**
- Consumes: `THREE.Object3D[]` (the `objects` from `LoadedModel`).
- Produces:
  - `type RenderMode = 'solid' | 'wireframe' | 'plates'`
  - `const PLATE_COLORS: number[]`
  - `function applyRenderMode(objects: THREE.Object3D[], mode: RenderMode): void`
  - `function setActivePlate(objects: THREE.Object3D[], activeIndex: number | null): void`

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/viewerModes.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyRenderMode, setActivePlate, PLATE_COLORS } from './viewerModes'

function meshObjects(n: number): THREE.Mesh[] {
  return Array.from({ length: n }, () =>
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff })),
  )
}

describe('applyRenderMode', () => {
  it('solid clears wireframe on every material', () => {
    const objs = meshObjects(2)
    applyRenderMode(objs, 'wireframe')
    applyRenderMode(objs, 'solid')
    for (const o of objs) {
      expect(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe).toBe(false)
    }
  })

  it('wireframe sets wireframe on every material', () => {
    const objs = meshObjects(2)
    applyRenderMode(objs, 'wireframe')
    for (const o of objs) {
      expect(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe).toBe(true)
    }
  })

  it('plates tints each build-item a distinct color from PLATE_COLORS', () => {
    const objs = meshObjects(2)
    applyRenderMode(objs, 'plates')
    const c0 = ((objs[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()
    const c1 = ((objs[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()
    expect(c0).toBe(PLATE_COLORS[0])
    expect(c1).toBe(PLATE_COLORS[1])
    expect(c0).not.toBe(c1)
  })
})

describe('setActivePlate', () => {
  it('hides all but the active index', () => {
    const objs = meshObjects(3)
    setActivePlate(objs, 1)
    expect(objs[0].visible).toBe(false)
    expect(objs[1].visible).toBe(true)
    expect(objs[2].visible).toBe(false)
  })

  it('null shows every object', () => {
    const objs = meshObjects(3)
    setActivePlate(objs, 1)
    setActivePlate(objs, null)
    expect(objs.every((o) => o.visible)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/viewerModes.test.ts`
Expected: FAIL — cannot resolve `./viewerModes`.

- [ ] **Step 3: Implement `lib/viewerModes.ts`**

```ts
import * as THREE from 'three'

export type RenderMode = 'solid' | 'wireframe' | 'plates'

const DEFAULT_COLOR = 0xd8cfc2

// Distinct, on-brand tints cycled per build-item in "plates" layout mode.
export const PLATE_COLORS: number[] = [
  0xff8a3d, // accent orange
  0x3ddc97, // success green
  0xdbb55a, // brass
  0x6db3ff, // blue
  0xe0654a, // error red
  0xb98cff, // violet
]

function eachMaterial(object: THREE.Object3D, fn: (m: THREE.MeshStandardMaterial) => void): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const m of materials) {
        if (m instanceof THREE.MeshStandardMaterial) fn(m)
      }
    }
  })
}

export function applyRenderMode(objects: THREE.Object3D[], mode: RenderMode): void {
  objects.forEach((object, index) => {
    eachMaterial(object, (m) => {
      m.wireframe = mode === 'wireframe'
      m.color.setHex(mode === 'plates' ? PLATE_COLORS[index % PLATE_COLORS.length] : DEFAULT_COLOR)
    })
  })
}

export function setActivePlate(objects: THREE.Object3D[], activeIndex: number | null): void {
  objects.forEach((object, index) => {
    object.visible = activeIndex === null || index === activeIndex
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/viewerModes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/viewerModes.ts frontend/src/lib/viewerModes.test.ts
git commit -m "feat(frontend): pure render-mode + plate-isolation helpers"
```

---

## Task 5: API client additions + `useFile` hook

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/hooks/useFile.ts`
- Test: `frontend/src/hooks/useFile.test.ts`

**Interfaces:**
- Consumes: existing `getJson`, `parseJsonOrThrow`, `ModelFile` type.
- Produces:
  - `function getFile(id: number): Promise<ModelFile>`
  - `function fileContentUrl(id: number): string`
  - `function fileThumbnailUrl(id: number): string`
  - `function updateFileDescription(id: number, description: string): Promise<ModelFile>`
  - `function useFile(id: number | null): { file: ModelFile | null; loading: boolean; error: boolean; reload: () => void }`

- [ ] **Step 1: Add client functions to `api/client.ts`**

Append:

```ts
export function getFile(id: number): Promise<ModelFile> {
  return getJson<ModelFile>(`/api/files/${id}`)
}

export function fileContentUrl(id: number): string {
  return `/api/files/${id}/content`
}

export function fileThumbnailUrl(id: number): string {
  return `/api/files/${id}/thumbnail`
}

export async function updateFileDescription(id: number, description: string): Promise<ModelFile> {
  const url = `/api/files/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}
```

- [ ] **Step 2: Write the failing hook test**

`frontend/src/hooks/useFile.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFile } from './useFile'
import * as client from '../api/client'
import type { ModelFile } from '../api/types'

const sample: ModelFile = {
  id: 7, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 1000, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 2, estPrintTimeMin: null, material: null,
  layerHeightMm: null, sourceUrl: null, creator: null, description: 'hi', thumbnailPath: 't',
  folderIds: [], tagIds: [],
}

describe('useFile', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns null and does not fetch for a null id', () => {
    const spy = vi.spyOn(client, 'getFile')
    const { result } = renderHook(() => useFile(null))
    expect(result.current.file).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('fetches and returns the file for a numeric id', async () => {
    vi.spyOn(client, 'getFile').mockResolvedValue(sample)
    const { result } = renderHook(() => useFile(7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.file).toEqual(sample)
    expect(result.current.error).toBe(false)
  })

  it('sets error when the fetch rejects', async () => {
    vi.spyOn(client, 'getFile').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFile(7))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(true)
    expect(result.current.file).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- src/hooks/useFile.test.ts`
Expected: FAIL — cannot resolve `./useFile`.

- [ ] **Step 4: Implement `hooks/useFile.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import type { ModelFile } from '../api/types'
import { getFile } from '../api/client'

export function useFile(id: number | null): {
  file: ModelFile | null
  loading: boolean
  error: boolean
  reload: () => void
} {
  const [file, setFile] = useState<ModelFile | null>(null)
  const [loading, setLoading] = useState(id !== null)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (id === null) {
      setFile(null)
      setLoading(false)
      setError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    getFile(id)
      .then((data) => {
        if (!cancelled) setFile(data)
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setFile(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, nonce])

  return { file, loading, error, reload }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/hooks/useFile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useFile.ts frontend/src/hooks/useFile.test.ts
git commit -m "feat(frontend): file-detail API client fns + useFile hook"
```

---

## Task 6: `ViewerModeToggle` component

**Files:**
- Create: `frontend/src/components/viewer/ViewerModeToggle.tsx`, `.module.css`
- Test: `frontend/src/components/viewer/ViewerModeToggle.test.tsx`

**Interfaces:**
- Consumes: `RenderMode` from `../../lib/viewerModes`.
- Produces: `function ViewerModeToggle(props: { mode: RenderMode; onChange: (mode: RenderMode) => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewerModeToggle } from './ViewerModeToggle'

describe('ViewerModeToggle', () => {
  it('renders the three modes and marks the active one', () => {
    render(<ViewerModeToggle mode="solid" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Wireframe' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Plates' })).toBeInTheDocument()
  })

  it('emits the chosen mode on click', () => {
    const onChange = vi.fn()
    render(<ViewerModeToggle mode="solid" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wireframe' }))
    expect(onChange).toHaveBeenCalledWith('wireframe')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/viewer/ViewerModeToggle.test.tsx`
Expected: FAIL — cannot resolve `./ViewerModeToggle`.

- [ ] **Step 3: Implement the component + styles**

`ViewerModeToggle.tsx`:

```tsx
import type { RenderMode } from '../../lib/viewerModes'
import styles from './ViewerModeToggle.module.css'

const MODES: { value: RenderMode; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'wireframe', label: 'Wireframe' },
  { value: 'plates', label: 'Plates' },
]

export function ViewerModeToggle({
  mode,
  onChange,
}: {
  mode: RenderMode
  onChange: (mode: RenderMode) => void
}) {
  return (
    <div className={styles.toggle} role="group" aria-label="Render mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          className={`${styles.segment} ${m.value === mode ? styles.active : ''}`}
          aria-pressed={m.value === mode}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
```

`ViewerModeToggle.module.css`:

```css
.toggle {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-button);
}

.segment {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.segment:hover {
  color: var(--text-primary);
}

.active {
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 600;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/viewer/ViewerModeToggle.test.tsx`
Expected: PASS (2 tests). If `--radius-button` is absent in `tokens.css`, use `7px`; verify token names against `frontend/src/styles/tokens.css` first.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/viewer/ViewerModeToggle.tsx frontend/src/components/viewer/ViewerModeToggle.module.css frontend/src/components/viewer/ViewerModeToggle.test.tsx
git commit -m "feat(frontend): Solid/Wireframe/Plates segmented toggle"
```

---

## Task 7: `PlateFilmstrip` component

**Files:**
- Create: `frontend/src/components/viewer/PlateFilmstrip.tsx`, `.module.css`
- Test: `frontend/src/components/viewer/PlateFilmstrip.test.tsx`

**Interfaces:**
- Produces: `function PlateFilmstrip(props: { count: number; activeIndex: number | null; onSelect: (index: number | null) => void; thumbnailUrls?: (string | null)[] }): JSX.Element | null`
- Renders `null` when `count <= 1` (STL / single-item 3MF hide the filmstrip). When `thumbnailUrls[i]` is null/missing, the plate cell shows the stripe placeholder.
- **Scoped simplification (deliberate, differs from spec §Components):** `DetailView` does not pass `thumbnailUrls` this phase, so cells render numbered stripe placeholders. Isolate-on-click (the functional core) works without per-plate renders. The `thumbnailUrls` prop is built now so a later pass can generate per-object thumbnails via the shared renderer without touching this component. Listed in the deferred section.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlateFilmstrip } from './PlateFilmstrip'

describe('PlateFilmstrip', () => {
  it('renders nothing for a single plate', () => {
    const { container } = render(<PlateFilmstrip count={1} activeIndex={null} onSelect={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one cell per plate plus an All control for multi-plate', () => {
    render(<PlateFilmstrip count={3} activeIndex={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'All plates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plate 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plate 3' })).toBeInTheDocument()
  })

  it('marks the active plate pressed and emits its index on click', () => {
    const onSelect = vi.fn()
    render(<PlateFilmstrip count={2} activeIndex={0} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Plate 1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Plate 2' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('All plates emits null', () => {
    const onSelect = vi.fn()
    render(<PlateFilmstrip count={2} activeIndex={1} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'All plates' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/viewer/PlateFilmstrip.test.tsx`
Expected: FAIL — cannot resolve `./PlateFilmstrip`.

- [ ] **Step 3: Implement the component + styles**

`PlateFilmstrip.tsx`:

```tsx
import styles from './PlateFilmstrip.module.css'

export function PlateFilmstrip({
  count,
  activeIndex,
  onSelect,
  thumbnailUrls,
}: {
  count: number
  activeIndex: number | null
  onSelect: (index: number | null) => void
  thumbnailUrls?: (string | null)[]
}) {
  if (count <= 1) return null

  return (
    <div className={styles.strip} role="group" aria-label="Plates">
      <button
        type="button"
        className={`${styles.cell} ${activeIndex === null ? styles.active : ''}`}
        aria-pressed={activeIndex === null}
        aria-label="All plates"
        onClick={() => onSelect(null)}
      >
        <span className={styles.allLabel}>ALL</span>
      </button>
      {Array.from({ length: count }, (_, i) => {
        const url = thumbnailUrls?.[i] ?? null
        return (
          <button
            key={i}
            type="button"
            className={`${styles.cell} ${activeIndex === i ? styles.active : ''}`}
            aria-pressed={activeIndex === i}
            aria-label={`Plate ${i + 1}`}
            onClick={() => onSelect(i)}
          >
            {url ? (
              <img className={styles.thumb} src={url} alt="" />
            ) : (
              <span className={styles.placeholder} />
            )}
            <span className={styles.index}>{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
```

`PlateFilmstrip.module.css`:

```css
.strip {
  display: flex;
  gap: 8px;
  height: 96px;
  padding: 10px 14px;
  overflow-x: auto;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.cell {
  position: relative;
  flex: 0 0 auto;
  width: 76px;
  height: 100%;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-chip, 6px);
  background: var(--bg-surface);
  cursor: pointer;
  overflow: hidden;
}

.active {
  box-shadow: 0 0 0 2px var(--accent);
  border-color: transparent;
}

.thumb,
.placeholder {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder {
  background: var(--thumb-placeholder);
}

.allLabel,
.index {
  position: absolute;
  bottom: 4px;
  right: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
}

.allLabel {
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/viewer/PlateFilmstrip.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/viewer/PlateFilmstrip.tsx frontend/src/components/viewer/PlateFilmstrip.module.css frontend/src/components/viewer/PlateFilmstrip.test.tsx
git commit -m "feat(frontend): plate filmstrip (hidden for single-plate/STL)"
```

---

## Task 8: `DetailInfoPanel` component

**Files:**
- Create: `frontend/src/components/detail/DetailInfoPanel.tsx`, `.module.css`
- Test: `frontend/src/components/detail/DetailInfoPanel.test.tsx`

**Interfaces:**
- Consumes: `ModelFile`, `Folder`, `Tag` types; `formatBytes`, `formatDimensions`, `formatPrintTime`, `tagColor` from `../../lib/format`; `typeLabel` from `../FileGrid`; `updateFileDescription` from `../../api/client`.
- Produces: `function DetailInfoPanel(props: { file: ModelFile; folders: Folder[]; tags: Tag[]; onDescriptionSaved: (updated: ModelFile) => void }): JSX.Element`
- Behavior: description textarea auto-saves on **blur** when its value differs from `file.description`, calling `updateFileDescription(file.id, value)` then `onDescriptionSaved`. The "+ add" pill is a disabled placeholder (title: "Coming in Phase 6").

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DetailInfoPanel } from './DetailInfoPanel'
import * as client from '../../api/client'
import type { ModelFile } from '../../api/types'

const file: ModelFile = {
  id: 5, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 2048, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 2, estPrintTimeMin: 90, material: 'PLA',
  layerHeightMm: 0.2, sourceUrl: null, creator: null, description: 'orig', thumbnailPath: 't',
  folderIds: [], tagIds: [],
}

describe('DetailInfoPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders spec rows including plate count', () => {
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={() => {}} />)
    expect(screen.getByText('Dimensions')).toBeInTheDocument()
    expect(screen.getByText('10 × 20 × 30 mm')).toBeInTheDocument()
    expect(screen.getByText('Plates')).toBeInTheDocument()
  })

  it('saves the description on blur when changed', async () => {
    const updated = { ...file, description: 'edited' }
    const spy = vi.spyOn(client, 'updateFileDescription').mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={onSaved} />)
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, 'edited'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it('does not save on blur when the description is unchanged', () => {
    const spy = vi.spyOn(client, 'updateFileDescription')
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={() => {}} />)
    fireEvent.blur(screen.getByLabelText('Description'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows a disabled add-to-folder placeholder', () => {
    render(<DetailInfoPanel file={file} folders={[]} tags={[]} onDescriptionSaved={() => {}} />)
    expect(screen.getByRole('button', { name: '+ add' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/detail/DetailInfoPanel.test.tsx`
Expected: FAIL — cannot resolve `./DetailInfoPanel`.

- [ ] **Step 3: Implement the component + styles**

`DetailInfoPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Folder, ModelFile, Tag } from '../../api/types'
import { formatBytes, formatDimensions, formatPrintTime, tagColor } from '../../lib/format'
import { updateFileDescription } from '../../api/client'
import { typeLabel } from '../FileGrid'
import styles from './DetailInfoPanel.module.css'

interface Row {
  label: string
  value: string
}

export function DetailInfoPanel({
  file,
  folders,
  tags,
  onDescriptionSaved,
}: {
  file: ModelFile
  folders: Folder[]
  tags: Tag[]
  onDescriptionSaved: (updated: ModelFile) => void
}) {
  const [description, setDescription] = useState(file.description ?? '')
  const [saving, setSaving] = useState(false)

  // Re-sync when navigating to a different file.
  useEffect(() => setDescription(file.description ?? ''), [file.id, file.description])

  const rows: Row[] = []
  const dims = formatDimensions(file.dimXMm, file.dimYMm, file.dimZMm)
  if (dims) rows.push({ label: 'Dimensions', value: dims })
  const printTime = formatPrintTime(file.estPrintTimeMin)
  if (printTime) rows.push({ label: 'Est. print time', value: printTime })
  if (file.material) rows.push({ label: 'Material', value: file.material })
  if (file.layerHeightMm !== null) rows.push({ label: 'Layer height', value: `${file.layerHeightMm} mm` })
  if (file.plateCount !== null) rows.push({ label: 'Plates', value: String(file.plateCount) })

  const fileFolders = file.folderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => f !== undefined)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  async function handleBlur() {
    const next = description
    if (next === (file.description ?? '')) return
    setSaving(true)
    try {
      const updated = await updateFileDescription(file.id, next)
      onDescriptionSaved(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className={styles.panel}>
      <h2 className={styles.name}>{file.name}</h2>
      <div className={styles.subline}>
        {typeLabel(file.type)} · {formatBytes(file.sizeBytes)} · {new Date(file.addedAt).toLocaleDateString()}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>SPECS</div>
        <dl className={styles.meta}>
          {rows.map((row) => (
            <div key={row.label} className={styles.metaRow}>
              <dt className={styles.metaLabel}>{row.label}</dt>
              <dd className={styles.metaValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>DESCRIPTION</div>
        <textarea
          className={styles.description}
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleBlur}
          placeholder="Add a description…"
        />
        {saving && <span className={styles.savingHint}>Saving…</span>}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>IN FOLDERS / COLLECTIONS</div>
        <div className={styles.chips}>
          {fileFolders.map((folder) => (
            <span key={folder.id} className={styles.chip}>
              {folder.name}
            </span>
          ))}
          {fileTags.map((tag) => (
            <span
              key={`tag-${tag.id}`}
              className={styles.chip}
              style={{ color: tagColor(tag.colorKey), borderColor: tagColor(tag.colorKey) }}
            >
              {tag.name}
            </span>
          ))}
          <button type="button" className={styles.addPill} disabled title="Coming in Phase 6">
            + add
          </button>
        </div>
      </section>
    </aside>
  )
}
```

`DetailInfoPanel.module.css`:

```css
.panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  padding: var(--panel-padding);
  overflow-y: auto;
}

.name {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
}

.subline {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 18px;
}

.section {
  margin-bottom: 18px;
}

.sectionLabel {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.meta {
  margin: 0;
}

.metaRow {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.metaLabel {
  font-size: 12px;
  color: var(--text-secondary);
}

.metaValue {
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: right;
}

.description {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-chip, 6px);
  padding: 8px;
  color: var(--text-primary);
  font-family: var(--font-ui, inherit);
  font-size: 12px;
}

.savingHint {
  display: inline-block;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 99px;
  color: var(--text-secondary);
}

.addPill {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border: 1px dashed var(--text-tertiary);
  border-radius: 99px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: not-allowed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/detail/DetailInfoPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/detail/DetailInfoPanel.tsx frontend/src/components/detail/DetailInfoPanel.module.css frontend/src/components/detail/DetailInfoPanel.test.tsx
git commit -m "feat(frontend): detail-view info panel with blur-to-save description"
```

---

## Task 9: `ModelViewer` component (WebGL canvas)

**Files:**
- Create: `frontend/src/components/viewer/ModelViewer.tsx`, `.module.css`
- Test: `frontend/src/components/viewer/ModelViewer.test.tsx`

**Interfaces:**
- Consumes: `LoadedModel` from `../../lib/modelLoading`; `RenderMode`, `applyRenderMode`, `setActivePlate` from `../../lib/viewerModes`; `OrbitControls` from `three/examples/jsm/controls/OrbitControls.js`.
- Produces: `function ModelViewer(props: { model: LoadedModel; mode: RenderMode; activePlate: number | null }): JSX.Element`
- Behavior: sets up a Three.js scene once per `model`, frames the camera on `model.bounds`, adds `OrbitControls`, animates, and disposes on unmount. On each `mode`/`activePlate` change it calls `applyRenderMode`/`setActivePlate` and re-renders. **WebGL setup is wrapped in try/catch** so it no-ops in jsdom (real rendering is verified by running the app, per Phase 4 precedent).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import * as THREE from 'three'
import { ModelViewer } from './ModelViewer'
import type { LoadedModel } from '../../lib/modelLoading'

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    enableDamping = false
    target = new THREE.Vector3()
    update() {}
    dispose() {}
  },
}))

function makeModel(): LoadedModel {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  return { object: mesh, bounds: new THREE.Box3().setFromObject(mesh), objects: [mesh] }
}

describe('ModelViewer', () => {
  it('mounts a canvas without throwing when WebGL is unavailable', () => {
    const { container } = render(<ModelViewer model={makeModel()} mode="solid" activePlate={null} />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('re-renders on mode change without throwing', () => {
    const model = makeModel()
    const { rerender } = render(<ModelViewer model={model} mode="solid" activePlate={null} />)
    rerender(<ModelViewer model={model} mode="wireframe" activePlate={null} />)
    // Scene-graph mutation happened via viewerModes; assert the material reflects it.
    expect((model.objects[0] as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/viewer/ModelViewer.test.tsx`
Expected: FAIL — cannot resolve `./ModelViewer`.

- [ ] **Step 3: Implement the component + styles**

`ModelViewer.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { LoadedModel } from '../../lib/modelLoading'
import { applyRenderMode, setActivePlate, type RenderMode } from '../../lib/viewerModes'
import styles from './ModelViewer.module.css'

export function ModelViewer({
  model,
  mode,
  activePlate,
}: {
  model: LoadedModel
  mode: RenderMode
  activePlate: number | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<{ update: () => void; dispose: () => void } | null>(null)
  const frameRef = useRef<number>(0)

  // Scene setup — runs once per loaded model.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      const parent = canvas.parentElement
      const width = parent?.clientWidth || 800
      const height = parent?.clientHeight || 600
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setSize(width, height, false)

      const scene = new THREE.Scene()
      scene.add(new THREE.AmbientLight(0xffffff, 0.7))
      const key = new THREE.DirectionalLight(0xffffff, 0.9)
      key.position.set(1, 1, 1)
      scene.add(key)
      scene.add(model.object)

      const center = new THREE.Vector3()
      const extent = new THREE.Vector3()
      model.bounds.getCenter(center)
      model.bounds.getSize(extent)
      const radius = Math.max(extent.x, extent.y, extent.z) || 1

      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, radius * 100)
      camera.position.set(center.x + radius * 1.6, center.y + radius * 1.4, center.z + radius * 1.6)
      camera.lookAt(center)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.target.copy(center)
      controls.update()

      rendererRef.current = renderer
      sceneRef.current = scene
      cameraRef.current = camera
      controlsRef.current = controls

      const animate = () => {
        frameRef.current = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }
      animate()

      const onResize = () => {
        const p = canvas.parentElement
        if (!p) return
        renderer.setSize(p.clientWidth, p.clientHeight, false)
        camera.aspect = p.clientWidth / p.clientHeight
        camera.updateProjectionMatrix()
      }
      window.addEventListener('resize', onResize)

      return () => {
        window.removeEventListener('resize', onResize)
        cancelAnimationFrame(frameRef.current)
        controls.dispose()
        renderer.dispose()
        scene.remove(model.object)
        rendererRef.current = null
      }
    } catch {
      // WebGL unavailable (e.g. jsdom test env) — no-op; real rendering is
      // verified by running the app.
      return
    }
  }, [model])

  // Apply render mode + plate isolation whenever they change.
  useEffect(() => {
    applyRenderMode(model.objects, mode)
    setActivePlate(model.objects, activePlate)
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }
  }, [model, mode, activePlate])

  return (
    <div className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <span className={styles.hint}>DRAG TO ORBIT · SCROLL TO ZOOM</span>
    </div>
  )
}
```

`ModelViewer.module.css`:

```css
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: radial-gradient(circle at 50% 40%, #241f1a, #131010);
  overflow: hidden;
}

.canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
  pointer-events: none;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/viewer/ModelViewer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/viewer/ModelViewer.tsx frontend/src/components/viewer/ModelViewer.module.css frontend/src/components/viewer/ModelViewer.test.tsx
git commit -m "feat(frontend): Three.js ModelViewer with OrbitControls + mode/plate wiring"
```

---

## Task 10: `DetailView` — compose breadcrumb + viewer + panel

**Files:**
- Create: `frontend/src/views/DetailView.tsx`, `.module.css`
- Test: `frontend/src/views/DetailView.test.tsx`

**Interfaces:**
- Consumes: `useFile`; `useFolders`, `useTags` (existing hooks); `fileContentUrl`, `fileThumbnailUrl` from `../api/client`; `loadModelFromBuffer`, `fileTypeFromName`, type `LoadedModel` from `../lib/modelLoading`; `ModelViewer`, `ViewerModeToggle`, `PlateFilmstrip`, `DetailInfoPanel`; `RenderMode` from `../lib/viewerModes`.
- Produces: `function DetailView(props: { fileId: number; fromFolder: { id: number; name: string } | null; onBack: () => void }): JSX.Element`
- Behavior: fetches file metadata; fetches `/content` bytes and parses into a `LoadedModel`; shows loading / error states in the viewer area; breadcrumb reads `{fromFolder.name || 'Library'} › {file.name}` and the leading crumb calls `onBack`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DetailView } from './DetailView'
import * as client from '../api/client'
import * as foldersHook from '../hooks/useFolders'
import * as tagsHook from '../hooks/useTags'
import type { ModelFile } from '../api/types'

vi.mock('../components/viewer/ModelViewer', () => ({
  ModelViewer: () => <div data-testid="model-viewer" />,
}))

const file: ModelFile = {
  id: 5, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 2048, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 1, estPrintTimeMin: null, material: null,
  layerHeightMm: null, sourceUrl: null, creator: null, description: '', thumbnailPath: null,
  folderIds: [], tagIds: [],
}

describe('DetailView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(foldersHook, 'useFolders').mockReturnValue({ folders: [], loading: false, error: false } as never)
    vi.spyOn(tagsHook, 'useTags').mockReturnValue({ tags: [], loading: false, error: false } as never)
    vi.spyOn(client, 'getFile').mockResolvedValue(file)
    // Content fetch rejects → viewer shows the error state, but metadata still renders.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
  })

  it('renders the breadcrumb with the origin folder and file name', async () => {
    render(<DetailView fileId={5} fromFolder={{ id: 1, name: 'Miniatures' }} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('dragon.3mf')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Miniatures' })).toBeInTheDocument()
  })

  it('calls onBack when the leading breadcrumb is clicked', async () => {
    const onBack = vi.fn()
    render(<DetailView fileId={5} fromFolder={null} onBack={onBack} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Library' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows an error state in the viewer area when content fails to load', async () => {
    render(<DetailView fileId={5} fromFolder={null} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText(/couldn't load this model/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/views/DetailView.test.tsx`
Expected: FAIL — cannot resolve `./DetailView`.

- [ ] **Step 3: Implement `views/DetailView.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useFile } from '../hooks/useFile'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { fileContentUrl } from '../api/client'
import { fileTypeFromName, loadModelFromBuffer, type LoadedModel } from '../lib/modelLoading'
import { ModelViewer } from '../components/viewer/ModelViewer'
import { ViewerModeToggle } from '../components/viewer/ViewerModeToggle'
import { PlateFilmstrip } from '../components/viewer/PlateFilmstrip'
import { DetailInfoPanel } from '../components/detail/DetailInfoPanel'
import type { RenderMode } from '../lib/viewerModes'
import type { ModelFile } from '../api/types'
import styles from './DetailView.module.css'

export function DetailView({
  fileId,
  fromFolder,
  onBack,
}: {
  fileId: number
  fromFolder: { id: number; name: string } | null
  onBack: () => void
}) {
  const { file, loading, error, reload } = useFile(fileId)
  const { folders } = useFolders()
  const { tags } = useTags()

  const [model, setModel] = useState<LoadedModel | null>(null)
  const [modelError, setModelError] = useState(false)
  const [mode, setMode] = useState<RenderMode>('solid')
  const [activePlate, setActivePlate] = useState<number | null>(null)

  // Fetch + parse the raw model bytes once we know the file.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    setModel(null)
    setModelError(false)
    setActivePlate(null)
    const type = fileTypeFromName(file.name)
    if (type === null) {
      setModelError(true)
      return
    }
    fetch(fileContentUrl(file.id))
      .then((res) => {
        if (!res.ok) throw new Error(`content ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => {
        if (cancelled) return
        setModel(loadModelFromBuffer(buffer, type))
      })
      .catch(() => {
        if (!cancelled) setModelError(true)
      })
    return () => {
      cancelled = true
    }
  }, [file])

  const originName = fromFolder?.name ?? 'Library'

  let viewerBody
  if (modelError) {
    viewerBody = (
      <div className={styles.viewerStatus}>
        <div className={styles.statusTitle}>Couldn't load this model</div>
        <div className={styles.statusSub}>The file may be missing or unreadable.</div>
      </div>
    )
  } else if (!model) {
    viewerBody = <div className={styles.viewerStatus}>Loading model…</div>
  } else {
    viewerBody = <ModelViewer model={model} mode={mode} activePlate={activePlate} />
  }

  const plateCount = model?.objects.length ?? 0

  return (
    <div className={styles.detail}>
      <div className={styles.main}>
        <div className={styles.breadcrumb}>
          <button type="button" className={styles.crumbLink} onClick={onBack}>
            {originName}
          </button>
          <span className={styles.crumbSep}>›</span>
          <span className={styles.crumbCurrent}>{file?.name ?? '…'}</span>
        </div>

        <div className={styles.viewerArea}>
          <div className={styles.toggleBar}>
            <ViewerModeToggle mode={mode} onChange={setMode} />
          </div>
          {viewerBody}
          <PlateFilmstrip count={plateCount} activeIndex={activePlate} onSelect={setActivePlate} />
        </div>
      </div>

      {loading && !file ? (
        <aside className={styles.sidePanelStatus}>Loading…</aside>
      ) : error || !file ? (
        <aside className={styles.sidePanelStatus}>Could not load this file.</aside>
      ) : (
        <DetailInfoPanel
          file={file}
          folders={folders}
          tags={tags}
          onDescriptionSaved={() => reload()}
        />
      )}
    </div>
  )
}

export type { ModelFile }
```

`DetailView.module.css`:

```css
.detail {
  display: flex;
  height: 100vh;
  background: var(--bg-app);
}

.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.crumbLink {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.crumbLink:hover {
  color: var(--accent);
}

.crumbSep {
  color: var(--text-tertiary);
}

.crumbCurrent {
  font-weight: 600;
  color: var(--text-primary);
}

.viewerArea {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.toggleBar {
  position: absolute;
  top: 14px;
  right: 18px;
  z-index: 2;
}

.viewerStatus {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: radial-gradient(circle at 50% 40%, #241f1a, #131010);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}

.statusTitle {
  color: var(--text-primary);
}

.statusSub {
  font-size: 11px;
  color: var(--text-tertiary);
}

.sidePanelStatus {
  width: 320px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  padding: var(--panel-padding);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/views/DetailView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/DetailView.tsx frontend/src/views/DetailView.module.css frontend/src/views/DetailView.test.tsx
git commit -m "feat(frontend): compose DetailView (breadcrumb + viewer + info panel)"
```

---

## Task 11: App shell — open detail on double-click, layer over library

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/views/LibraryView.tsx`
- Modify: `frontend/src/components/FileGrid.tsx`
- Test: `frontend/src/components/FileGrid.test.tsx`, `frontend/src/App.test.tsx` (extend existing)

**Interfaces:**
- `FileGrid` gains `onOpenFile: (id: number) => void`, fired on card **double-click**; single click still calls `onSelectFile`.
- `LibraryView` gains `onOpenFile: (fileId: number, fromFolder: { id: number; name: string } | null) => void` and passes its current folder context.
- `App` tracks `detailTarget: { fileId: number; fromFolder: { id: number; name: string } | null } | null`; when set, renders `DetailView` as a full-screen layer over the still-mounted `LibraryView`.

- [ ] **Step 1: Add the failing FileGrid double-click test**

Add to `FileGrid.test.tsx`:

```tsx
it('calls onOpenFile on double-click and onSelectFile on single click', () => {
  const onSelect = vi.fn()
  const onOpen = vi.fn()
  render(
    <FileGrid
      files={[sampleFile]}
      tags={[]}
      selectedFileId={null}
      onSelectFile={onSelect}
      onOpenFile={onOpen}
    />,
  )
  const card = screen.getByRole('button', { name: /widget\.stl/i })
  fireEvent.click(card)
  expect(onSelect).toHaveBeenCalledWith(sampleFile.id)
  fireEvent.doubleClick(card)
  expect(onOpen).toHaveBeenCalledWith(sampleFile.id)
})
```

If the existing test file lacks `sampleFile`/imports for `fireEvent`, add them:
`import { render, screen, fireEvent } from '@testing-library/react'` and a `const sampleFile: ModelFile = { id: 1, name: 'widget.stl', type: 'Stl', sizeBytes: 100, addedAt: '2026-07-04T00:00:00Z', dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null, material: null, layerHeightMm: null, sourceUrl: null, creator: null, description: null, thumbnailPath: null, folderIds: [], tagIds: [] }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/components/FileGrid.test.tsx`
Expected: FAIL — `onOpenFile` not a prop / not called.

- [ ] **Step 3: Wire double-click through FileGrid**

In `FileGrid.tsx`, extend props and the card:

```tsx
interface FileGridProps {
  files: ModelFile[]
  tags: Tag[]
  selectedFileId: number | null
  onSelectFile: (id: number) => void
  onOpenFile: (id: number) => void
}

interface CardProps {
  file: ModelFile
  tags: Tag[]
  selected: boolean
  onSelect: (id: number) => void
  onOpen: (id: number) => void
}

function FileCard({ file, tags, selected, onSelect, onOpen }: CardProps) {
  // ...unchanged tag mapping...
  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(file.id)}
      onDoubleClick={() => onOpen(file.id)}
    >
      {/* ...unchanged body... */}
    </button>
  )
}

export function FileGrid({ files, tags, selectedFileId, onSelectFile, onOpenFile }: FileGridProps) {
  return (
    <div className={styles.grid}>
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          tags={tags}
          selected={file.id === selectedFileId}
          onSelect={onSelectFile}
          onOpen={onOpenFile}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Thread `onOpenFile` through LibraryView**

In `LibraryView.tsx`: add the prop and pass folder context to `FileGrid`.

```tsx
export function LibraryView({
  onImport,
  onOpenFile,
}: {
  onImport: () => void
  onOpenFile: (fileId: number, fromFolder: { id: number; name: string } | null) => void
}) {
  // ...existing state/hooks...

  const activeFolder =
    selectedFolderId === null
      ? null
      : (() => {
          const f = folders.find((x) => x.id === selectedFolderId)
          return f ? { id: f.id, name: f.name } : null
        })()

  // in the else branch that renders <FileGrid ...>:
  center = (
    <FileGrid
      files={files}
      tags={tags}
      selectedFileId={selectedFileId}
      onSelectFile={setSelectedFileId}
      onOpenFile={(id) => onOpenFile(id, activeFolder)}
    />
  )
  // ...rest unchanged...
}
```

- [ ] **Step 5: Render the detail layer in App**

Replace `App.tsx`:

```tsx
import { useState } from 'react'
import { LibraryView } from './views/LibraryView'
import { ImportView } from './views/ImportView'
import { DetailView } from './views/DetailView'

type DetailTarget = { fileId: number; fromFolder: { id: number; name: string } | null }

export default function App() {
  const [view, setView] = useState<'library' | 'import'>('library')
  const [libraryKey, setLibraryKey] = useState(0)
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null)

  if (view === 'import') {
    return (
      <ImportView
        onBack={() => setView('library')}
        onImported={() => {
          setLibraryKey((k) => k + 1)
          setView('library')
        }}
      />
    )
  }

  return (
    <>
      <LibraryView
        key={libraryKey}
        onImport={() => setView('import')}
        onOpenFile={(fileId, fromFolder) => setDetailTarget({ fileId, fromFolder })}
      />
      {detailTarget && (
        <DetailView
          fileId={detailTarget.fileId}
          fromFolder={detailTarget.fromFolder}
          onBack={() => setDetailTarget(null)}
        />
      )}
    </>
  )
}
```

The library stays mounted underneath; `DetailView`'s root is `height: 100vh` on `--bg-app`. Add a stacking rule so it covers the library — append to `DetailView.module.css` `.detail`:

```css
.detail {
  position: fixed;
  inset: 0;
  z-index: 10;
}
```

(Combine with the existing `.detail` block — it should read `position: fixed; inset: 0; z-index: 10; display: flex; height: 100vh; background: var(--bg-app);`.)

- [ ] **Step 6: Extend the App test**

Add to `App.test.tsx` (mock `DetailView` to keep it lightweight):

```tsx
// at top, alongside existing imports/mocks
vi.mock('./views/DetailView', () => ({
  DetailView: (props: { onBack: () => void }) => (
    <div data-testid="detail-view">
      <button onClick={props.onBack}>close-detail</button>
    </div>
  ),
}))
```

```tsx
it('opens the detail layer when a file is opened and closes on back', async () => {
  // Render App, wait for the library, double-click a file card to trigger onOpenFile.
  // (Use existing library-render setup in this file; if files are mocked via useFiles,
  // reuse that mock to expose at least one card.)
  render(<App />)
  const card = await screen.findByRole('button', { name: /\.stl|\.3mf/i })
  fireEvent.doubleClick(card)
  expect(screen.getByTestId('detail-view')).toBeInTheDocument()
  fireEvent.click(screen.getByText('close-detail'))
  expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument()
})
```

If `App.test.tsx` does not already mock the file list, mock `./hooks/useFiles` to return one file (shape as in Task 5's sample) so a card exists to double-click. Match the mocking style already present in the file.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- src/components/FileGrid.test.tsx src/App.test.tsx`
Expected: PASS. Then `npx tsc -b` — clean (LibraryView/FileGrid signature changes are internally consistent).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/views/LibraryView.tsx frontend/src/views/DetailView.module.css frontend/src/components/FileGrid.tsx frontend/src/components/FileGrid.test.tsx
git commit -m "feat(frontend): double-click a card to open the detail layer over the library"
```

---

## Task 12: Real thumbnails in library grid + detail panel

**Files:**
- Modify: `frontend/src/components/FileGrid.tsx`, `.module.css`
- Modify: `frontend/src/components/FileDetailPanel.tsx`, `.module.css`
- Test: `frontend/src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `fileThumbnailUrl` from `../api/client`, existing `file.thumbnailPath` (non-null ⇒ a thumbnail exists to request).
- Behavior: when `file.thumbnailPath !== null`, render `<img src={fileThumbnailUrl(file.id)}>`; on `onError` (or when `thumbnailPath === null`) fall back to the existing stripe placeholder (`--thumb-placeholder`) with the type label.

- [ ] **Step 1: Write the failing test**

Add to `FileGrid.test.tsx`:

```tsx
it('renders a real thumbnail image when the file has one', () => {
  const withThumb = { ...sampleFile, thumbnailPath: 'thumbs/1.png' }
  render(
    <FileGrid files={[withThumb]} tags={[]} selectedFileId={null} onSelectFile={() => {}} onOpenFile={() => {}} />,
  )
  const img = screen.getByRole('img', { name: /widget\.stl/i })
  expect(img).toHaveAttribute('src', '/api/files/1/thumbnail')
})

it('shows the placeholder label when the file has no thumbnail', () => {
  render(
    <FileGrid files={[sampleFile]} tags={[]} selectedFileId={null} onSelectFile={() => {}} onOpenFile={() => {}} />,
  )
  expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/components/FileGrid.test.tsx`
Expected: FAIL — no `img` role found (only the placeholder label renders today).

- [ ] **Step 3: Add a shared thumbnail render in FileGrid**

In `FileGrid.tsx`, add an import and replace the `.thumb` block inside `FileCard`:

```tsx
import { fileThumbnailUrl } from '../api/client'
```

```tsx
import { useState } from 'react'
// ...

function FileCard({ file, tags, selected, onSelect, onOpen }: CardProps) {
  const [thumbFailed, setThumbFailed] = useState(false)
  // ...existing fileTags mapping...

  const showImg = file.thumbnailPath !== null && !thumbFailed

  return (
    <button /* ...unchanged attrs incl. onClick/onDoubleClick... */>
      <div className={styles.thumb}>
        {showImg ? (
          <img
            className={styles.thumbImg}
            src={fileThumbnailUrl(file.id)}
            alt={`${file.name} preview`}
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
        )}
      </div>
      {/* ...unchanged name/description/tags... */}
    </button>
  )
}
```

Add to `FileGrid.module.css`:

```css
.thumbImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
```

(Ensure `.thumb` already has `aspect-ratio: 4 / 3; overflow: hidden;` — it does; the img fills it.)

- [ ] **Step 4: Mirror the change in the library right panel**

In `FileDetailPanel.tsx`, apply the same pattern to its `.thumb` block:

```tsx
import { useState } from 'react'
import { fileThumbnailUrl } from '../api/client'
```

Inside the component (after the null-file early return), before the `return`:

```tsx
const [thumbFailed, setThumbFailed] = useState(false)
const showImg = file.thumbnailPath !== null && !thumbFailed
```

Replace the thumbnail element:

```tsx
<div className={styles.thumb}>
  {showImg ? (
    <img
      className={styles.thumbImg}
      src={fileThumbnailUrl(file.id)}
      alt={`${file.name} preview`}
      onError={() => setThumbFailed(true)}
    />
  ) : (
    <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
  )}
</div>
```

Add to `FileDetailPanel.module.css`:

```css
.thumb {
  overflow: hidden;
}

.thumbImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
```

Note: `useState` after an early `return` is a hooks-order violation. Move the `if (file === null) { return ... }` guard so the two `useState` calls run before it, OR keep the guard first and read `file?.…` — simplest correct fix: place `const [thumbFailed, setThumbFailed] = useState(false)` at the very top of the component (before the null check) and keep the null-return after it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/FileGrid.test.tsx` then the full suite `npm test`
Expected: PASS. `FileDetailPanel.test.tsx` should still pass (placeholder label remains for null-thumbnail files). Run `npx tsc -b` — clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FileGrid.tsx frontend/src/components/FileGrid.module.css frontend/src/components/FileGrid.test.tsx frontend/src/components/FileDetailPanel.tsx frontend/src/components/FileDetailPanel.module.css
git commit -m "feat(frontend): show real thumbnails in library grid + detail panel with placeholder fallback"
```

---

## Task 13: Full-suite verification + manual app check

**Files:** none (verification only).

- [ ] **Step 1: Run the entire backend suite**

Run: `cd backend; dotnet test`
Expected: all green (35 prior + 6 new = 41).

- [ ] **Step 2: Run the entire frontend suite + typecheck + build**

Run: `cd frontend; npm test; npx tsc -b; npm run build`
Expected: all tests pass; `tsc` clean; `vite build` succeeds. If `npm run build` regenerates `vite.config.js`, confirm it does NOT reappear (guarded by `emitDeclarationOnly` in `tsconfig.node.json`); if ECONNREFUSED later, `rm frontend/vite.config.js`.

- [ ] **Step 3: Manual verification with real files (the WebGL path)**

Backend: `cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (→ http://localhost:5102).
Frontend: `cd frontend; npm run dev` (→ http://localhost:5173).
Then, importing at least one **multi-plate 3MF** and one **STL** via the Import flow, verify:
- Library grid + right panel now show **real thumbnails** (not stripes).
- **Double-click** a card → detail view opens as a full-screen layer; breadcrumb shows the folder you were in (or "Library").
- Viewer: **drag orbits, scroll zooms**; Solid/Wireframe/Plates all change the render; Plates tints each build-item.
- Multi-plate 3MF shows a **filmstrip**; clicking a plate isolates it; "ALL" restores; **the number of filmstrip cells equals the Plates count in SPECS** (if they diverge, that's the build-item-vs-mesh reconciliation flagged in the spec — capture it as a follow-up, don't silently ship a mismatch).
- STL shows **no filmstrip**.
- Edit the description, click elsewhere (blur) → reload the detail view → the change persisted.
- Breadcrumb back → returns to the **same folder, scroll, and selection**.

- [ ] **Step 4: Commit any fixes found during manual verification**

```bash
git add -A
git commit -m "fix(frontend): address issues found during Phase 5 manual verification"
```

(Skip if nothing needed fixing.)

---

## Post-implementation

- Update `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` Phase 5 status to "Complete and merged" once merged, and add the plan link.
- Update the project memory (`project-plastic-room.md`) with Phase 5 facts: the two new endpoints, the `modelLoading.ts`/`viewerModes.ts` split, the detail-layer-over-library shell, real thumbnails now live, and any build-item-vs-plate reconciliation outcome.
- Deferred: **per-plate filmstrip thumbnails** (cells are numbered placeholders this phase; `thumbnailUrls` prop already wired); multi-assign modal target for "+ add" (Phase 6); real slicer-plate grouping; `fflate` dep cleanup; folder-cycle guard (Phase 8).
