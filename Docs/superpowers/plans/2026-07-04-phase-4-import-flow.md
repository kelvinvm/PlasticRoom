# Phase 4 — Import Flow (Screen 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag in real `.3mf`/`.stl` files, see each validated + previewed with client-parsed metadata and a Three.js thumbnail, assign folders/tags to the batch, and commit the import to the existing API.

**Architecture:** A full-screen import view (no router — a `view` toggle in `App.tsx`, with the existing three-pane extracted to `LibraryView`). A `lib/thumbnail.ts` seam loads geometry with Three.js and renders a PNG offscreen; a `useImportStaging` hook drives the per-file state machine (parse → ready/error → import). Commit reuses the existing `POST /api/files`, `POST /api/files/{id}/thumbnail`, and `POST /api/tags` endpoints; no new backend endpoints are expected.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library, CSS Modules over design tokens, Three.js (`STLLoader`/`3MFLoader`). Backend ASP.NET Core 10 (unchanged except a verified multipart-binding check).

## Global Constraints

- Frontend: plain React — **no data-fetching library, no state manager** (`useState`/`useEffect` + hooks in `src/hooks/`, pure utils in `src/lib/`).
- Styling: **CSS Modules** only, reading design-token CSS variables from `src/styles/tokens.css`. No inline color literals — use tokens (`--accent #ff8a3d`, `--success #3ddc97`, `--error #e0654a`, `--tag-brass #dbb55a`, surfaces `--bg-panel`/`--bg-surface`, borders `rgba(255,255,255,.08)`).
- Accepted uploads: **`.3mf` and `.stl` only** (case-insensitive extension).
- TS API types are **camelCase**, mirroring the backend DTOs, in `src/api/types.ts`.
- **Server is authoritative** for stored metadata: the client shows preview metadata (size + Three.js bbox dims + 3MF plate count) but never sends dims/plates; `POST /api/files` re-parses and stores them.
- **No print time** anywhere in the import UI (it is not derivable pre-import).
- Commit is **sequential**; partial success is valid (no batch rollback); thumbnail upload failure is **non-fatal**.
- Reuse existing helpers in `src/lib/format.ts`: `formatBytes`, `formatDimensions(x,y,z)`, `tagColor(colorKey)`, and the `brass|orange|green|red` color keys.
- Every task ends green: `cd frontend && npm test` (Vitest) must pass. Commit after each task.

---

## File Structure

**Create (frontend):**
- `src/lib/thumbnail.ts` — Three.js load + offscreen PNG render; exports `generateThumbnail`, `fileTypeFromName`, `dimsFromGeometry`, and the `ThumbnailResult`/`ThumbnailGenerator`/`ModelDims` types.
- `src/hooks/useImportStaging.ts` — staging state machine + commit orchestration.
- `src/components/import/DropZone.tsx` (+ `.module.css`) — drag/drop + click-to-browse.
- `src/components/import/StagingRow.tsx` (+ `.module.css`) — one staging row.
- `src/components/import/ImportAssignPanel.tsx` (+ `.module.css`) — "add all to folder" + "tags for all" + Import button.
- `src/views/ImportView.tsx` (+ `.module.css`) — composes the import screen.
- `src/views/LibraryView.tsx` (+ `.module.css`) — the existing three-pane, moved out of `App.tsx`.

**Modify (frontend):**
- `package.json` — add `three`, `@types/three`, `fflate`.
- `src/api/types.ts` — add request/response shapes.
- `src/api/client.ts` — add `uploadFile`, `uploadThumbnail`, `createTag`.
- `src/components/Sidebar.tsx` (+ test) — add an **Import** button (new `onImport` prop).
- `src/App.tsx` — becomes the thin `view` shell.
- `src/App.test.tsx` — assert shell + view toggle (library assertions still pass through `App`).

**Backend:** no code change expected; Task 2 includes a live multipart-binding verification against the running backend.

---

## Task 1: Three.js thumbnail module (`lib/thumbnail.ts`)

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/thumbnail.ts`
- Test: `frontend/src/lib/thumbnail.test.ts`

**Interfaces:**
- Produces:
  - `type ModelDims = { x: number; y: number; z: number }`
  - `interface ThumbnailResult { pngBlob: Blob; dims: ModelDims; plateCount: number | null }`
  - `type ThumbnailGenerator = (file: File) => Promise<ThumbnailResult>`
  - `function fileTypeFromName(name: string): 'ThreeMf' | 'Stl' | null`
  - `function dimsFromGeometry(geometry: THREE.BufferGeometry): ModelDims`
  - `const generateThumbnail: ThumbnailGenerator`

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd frontend && npm install three fflate && npm install -D @types/three
```
Expected: `package.json` gains `three`, `fflate` (dependencies) and `@types/three` (devDependencies); install exits 0.

- [ ] **Step 2: Write the failing test** — `frontend/src/lib/thumbnail.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { fileTypeFromName, dimsFromGeometry } from './thumbnail'

describe('fileTypeFromName', () => {
  it('recognizes .stl and .3mf case-insensitively', () => {
    expect(fileTypeFromName('Widget.STL')).toBe('Stl')
    expect(fileTypeFromName('plate.3mf')).toBe('ThreeMf')
  })
  it('returns null for anything else', () => {
    expect(fileTypeFromName('notes.txt')).toBeNull()
    expect(fileTypeFromName('noextension')).toBeNull()
  })
})

describe('dimsFromGeometry', () => {
  it('returns the bounding-box size in x/y/z', () => {
    const geometry = new THREE.BoxGeometry(4, 2, 6) // width, height, depth
    const dims = dimsFromGeometry(geometry)
    expect(dims.x).toBeCloseTo(4)
    expect(dims.y).toBeCloseTo(2)
    expect(dims.z).toBeCloseTo(6)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/thumbnail.test.ts`
Expected: FAIL — `thumbnail.ts` / exports do not exist.

- [ ] **Step 4: Write the implementation** — `frontend/src/lib/thumbnail.ts`

```ts
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'

export type ModelDims = { x: number; y: number; z: number }

export interface ThumbnailResult {
  pngBlob: Blob
  dims: ModelDims
  plateCount: number | null
}

export type ThumbnailGenerator = (file: File) => Promise<ThumbnailResult>

export function fileTypeFromName(name: string): 'ThreeMf' | 'Stl' | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.stl')) return 'Stl'
  if (lower.endsWith('.3mf')) return 'ThreeMf'
  return null
}

export function dimsFromGeometry(geometry: THREE.BufferGeometry): ModelDims {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox ?? new THREE.Box3()
  const size = new THREE.Vector3()
  box.getSize(size)
  return { x: size.x, y: size.y, z: size.z }
}

// Loads the file into a THREE.Object3D + geometry for measuring, and a plate
// count for 3MF (build items). Pure JS — no WebGL — but not asserted in tests
// because it needs the loaders' runtime; exercised by running the app.
async function loadModel(
  file: File,
): Promise<{ object: THREE.Object3D; geometry: THREE.BufferGeometry; plateCount: number | null }> {
  const buffer = await file.arrayBuffer()
  const type = fileTypeFromName(file.name)
  if (type === 'Stl') {
    const geometry = new STLLoader().parse(buffer)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd8cfc2 }))
    return { object: mesh, geometry, plateCount: null }
  }
  if (type === 'ThreeMf') {
    const group = new ThreeMFLoader().parse(buffer)
    const merged = new THREE.BufferGeometry()
    const positions: number[] = []
    let plateCount = 0
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        plateCount += 1
        const pos = (child.geometry as THREE.BufferGeometry).attributes.position
        if (pos) for (let i = 0; i < pos.array.length; i++) positions.push(pos.array[i] as number)
      }
    })
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return { object: group, geometry: merged, plateCount: plateCount || 1 }
  }
  throw new Error('Unsupported file type')
}

function renderToPng(object: THREE.Object3D, geometry: THREE.BufferGeometry): Promise<Blob> {
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

  geometry.computeBoundingBox()
  const box = geometry.boundingBox ?? new THREE.Box3()
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
  const { object, geometry, plateCount } = await loadModel(file)
  const dims = dimsFromGeometry(geometry)
  const pngBlob = await renderToPng(object, geometry)
  return { pngBlob, dims, plateCount }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/thumbnail.test.ts`
Expected: PASS (both describe blocks).

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/thumbnail.ts frontend/src/lib/thumbnail.test.ts
git commit -m "feat(import): add Three.js thumbnail generation module"
```

---

## Task 2: API client — upload file, upload thumbnail, create tag

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts` (extend)

**Interfaces:**
- Consumes: `ModelFile`, `Tag` from `./types`.
- Produces:
  - `function uploadFile(input: { file: File; folderIds: number[]; tagIds: number[] }): Promise<ModelFile>`
  - `function uploadThumbnail(fileId: number, pngBlob: Blob): Promise<ModelFile>`
  - `function createTag(name: string, colorKey: string | null): Promise<Tag>`

- [ ] **Step 1: Write the failing tests** — append to `frontend/src/api/client.test.ts`

```ts
import { createTag, uploadFile, uploadThumbnail } from './client'

describe('upload + tag mutations', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('uploadFile POSTs multipart with file + repeated folder/tag ids', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 1 }))
    const file = new File([new Uint8Array([1, 2, 3])], 'a.stl', { type: 'model/stl' })

    await uploadFile({ file, folderIds: [3, 4], tagIds: [7] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files')
    expect(init.method).toBe('POST')
    const body = init.body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.getAll('folderIds')).toEqual(['3', '4'])
    expect(body.getAll('tagIds')).toEqual(['7'])
  })

  it('uploadThumbnail POSTs the png under field "file" to the id route', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 9 }))
    const blob = new Blob([new Uint8Array([0])], { type: 'image/png' })

    await uploadThumbnail(9, blob)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/9/thumbnail')
    expect(init.method).toBe('POST')
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('createTag POSTs JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 5, name: 'Resin', colorKey: 'orange' }))

    const tag = await createTag('Resin', 'orange')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tags')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ name: 'Resin', colorKey: 'orange' })
    expect(tag.id).toBe(5)
  })

  it('throws when upload response is not ok', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 400 } as Response)
    const file = new File([new Uint8Array([1])], 'a.stl')
    await expect(uploadFile({ file, folderIds: [], tagIds: [] })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — `uploadFile`/`uploadThumbnail`/`createTag` are not exported.

- [ ] **Step 3: Add request/response types** — append to `frontend/src/api/types.ts`

```ts
export interface UploadFileInput {
  file: File
  folderIds: number[]
  tagIds: number[]
}
```

- [ ] **Step 4: Implement the client functions** — append to `frontend/src/api/client.ts`

```ts
import type { Folder, ModelFile, Tag, UploadFileInput } from './types'

async function parseJsonOrThrow<T>(res: Response, url: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
  return (await res.json()) as T
}

export async function uploadFile(input: UploadFileInput): Promise<ModelFile> {
  const form = new FormData()
  form.append('file', input.file)
  for (const id of input.folderIds) form.append('folderIds', String(id))
  for (const id of input.tagIds) form.append('tagIds', String(id))
  const res = await fetch('/api/files', { method: 'POST', body: form })
  return parseJsonOrThrow<ModelFile>(res, '/api/files')
}

export async function uploadThumbnail(fileId: number, pngBlob: Blob): Promise<ModelFile> {
  const url = `/api/files/${fileId}/thumbnail`
  const form = new FormData()
  form.append('file', new File([pngBlob], `${fileId}.png`, { type: 'image/png' }))
  const res = await fetch(url, { method: 'POST', body: form })
  return parseJsonOrThrow<ModelFile>(res, url)
}

export async function createTag(name: string, colorKey: string | null): Promise<Tag> {
  const res = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, colorKey }),
  })
  return parseJsonOrThrow<Tag>(res, '/api/tags')
}
```

> Note: `types.ts` imports must include `UploadFileInput`. The existing top import line `import type { Folder, ModelFile, Tag } from './types'` is replaced by the version above that adds `UploadFileInput`. Do not create a duplicate import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: PASS (all cases, including the pre-existing GET tests).

- [ ] **Step 6: Verify multipart array binding against the running backend**

The backend's own tests call `_controller.Upload(...)` directly and never exercise HTTP model binding, so confirm the wire format binds. With the backend running on `:5102` (seeded), run:

```bash
# create a folder to target, capture its id
FID=$(curl -s -X POST http://localhost:5102/api/folders -H 'Content-Type: application/json' \
  -d '{"name":"BindCheck","parentId":null}' | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
# minimal STL header (84 bytes: 80 header + 4-byte triangle count = 0)
head -c 84 /dev/zero > /tmp/empty.stl
curl -s -X POST http://localhost:5102/api/files \
  -F "file=@/tmp/empty.stl;filename=bindcheck.stl" \
  -F "folderIds=$FID" | grep -o "\"folderIds\":\[[0-9]*\]"
```
Expected: output contains `"folderIds":[<FID>]` — proving repeated `folderIds` form fields bind to `List<int> FolderIds`.

**If (and only if) it comes back `"folderIds":[]`:** the fix is backend, not frontend — annotate the collection params so form binding is explicit. In `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs`, change `UploadFileRequest` to `[FromForm(Name = "folderIds")] public List<int>? FolderIds { get; set; }` (and likewise `tagIds`), rebuild, and re-run the curl. Record the outcome in the commit message. (Clean up: `curl -s -X DELETE http://localhost:5102/api/folders/$FID`.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/types.ts frontend/src/api/client.test.ts
git commit -m "feat(import): add uploadFile, uploadThumbnail, createTag API client functions"
```

---

## Task 3: Staging hook — add/parse + selection (`useImportStaging`, part 1)

**Files:**
- Create: `frontend/src/hooks/useImportStaging.ts`
- Test: `frontend/src/hooks/useImportStaging.test.ts`

**Interfaces:**
- Consumes: `ThumbnailGenerator`, `ModelDims` from `../lib/thumbnail`; `uploadFile`, `uploadThumbnail`, `createTag` from `../api/client`; `Tag` from `../api/types`.
- Produces (full hook shape; Task 4 fills in commit fields):
```ts
export type StagingStatus =
  | 'parsing' | 'ready' | 'parse-error' | 'importing' | 'imported' | 'import-error'
export interface StagingItem {
  id: string
  file: File
  name: string
  status: StagingStatus
  error?: string
  sizeBytes: number
  dims?: ModelDims
  plateCount: number | null
  thumbnailUrl?: string
  thumbnailBlob?: Blob
}
export interface ImportStagingApi {
  uploadFile: typeof import('../api/client').uploadFile
  uploadThumbnail: typeof import('../api/client').uploadThumbnail
  createTag: typeof import('../api/client').createTag
}
export interface UseImportStagingDeps { generate: ThumbnailGenerator; api: ImportStagingApi }
export interface UseImportStaging {
  items: StagingItem[]
  addFiles(files: File[]): void
  detectedCount: number
  readyCount: number
  failedParseCount: number
  selectedFolderIds: number[]
  toggleFolder(id: number): void
  selectedTagIds: number[]
  toggleTag(id: number): void
  createdTags: Tag[]
  createAndSelectTag(name: string): Promise<void>
  importAll(): Promise<void>   // implemented in Task 4
  retryFailed(): Promise<void> // implemented in Task 4
  importing: boolean
  allDone: boolean
}
```

- [ ] **Step 1: Write the failing tests** — `frontend/src/hooks/useImportStaging.test.ts`

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImportStaging, type ImportStagingApi } from './useImportStaging'
import type { ThumbnailGenerator } from '../lib/thumbnail'

const stlFile = (name = 'a.stl') => new File([new Uint8Array([1, 2, 3])], name)

const okGenerate: ThumbnailGenerator = async () => ({
  pngBlob: new Blob([new Uint8Array([0])], { type: 'image/png' }),
  dims: { x: 10, y: 20, z: 30 },
  plateCount: null,
})

const stubApi = (): ImportStagingApi => ({
  uploadFile: vi.fn(async ({ file }) => ({ id: file.name.length })) as ImportStagingApi['uploadFile'],
  uploadThumbnail: vi.fn(async () => ({ id: 1 })) as ImportStagingApi['uploadThumbnail'],
  createTag: vi.fn(async (name: string, colorKey: string | null) => ({ id: 99, name, colorKey })) as ImportStagingApi['createTag'],
})

describe('useImportStaging — add/parse', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('marks a valid file ready with dims and counts it', async () => {
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api: stubApi() }))
    act(() => result.current.addFiles([stlFile('dragon.stl')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('ready'))
    expect(result.current.items[0].dims).toEqual({ x: 10, y: 20, z: 30 })
    expect(result.current.readyCount).toBe(1)
    expect(result.current.detectedCount).toBe(1)
    expect(result.current.failedParseCount).toBe(0)
  })

  it('marks an unsupported file as parse-error without calling generate', async () => {
    const generate = vi.fn(okGenerate)
    const { result } = renderHook(() => useImportStaging({ generate, api: stubApi() }))
    act(() => result.current.addFiles([new File([new Uint8Array([1])], 'notes.txt')]))
    await waitFor(() => expect(result.current.items[0].status).toBe('parse-error'))
    expect(generate).not.toHaveBeenCalled()
    expect(result.current.failedParseCount).toBe(1)
    expect(result.current.readyCount).toBe(0)
  })

  it('marks parse-error when generate throws', async () => {
    const generate: ThumbnailGenerator = async () => { throw new Error('corrupt') }
    const { result } = renderHook(() => useImportStaging({ generate, api: stubApi() }))
    act(() => result.current.addFiles([stlFile()]))
    await waitFor(() => expect(result.current.items[0].status).toBe('parse-error'))
    expect(result.current.items[0].error).toMatch(/parse|corrupt|geometry/i)
  })

  it('toggles folder and tag selection', () => {
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api: stubApi() }))
    act(() => result.current.toggleFolder(3))
    act(() => result.current.toggleTag(7))
    expect(result.current.selectedFolderIds).toEqual([3])
    expect(result.current.selectedTagIds).toEqual([7])
    act(() => result.current.toggleFolder(3))
    expect(result.current.selectedFolderIds).toEqual([])
  })

  it('creates a tag and selects it', async () => {
    const api = stubApi()
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api }))
    await act(async () => { await result.current.createAndSelectTag('Resin') })
    expect(api.createTag).toHaveBeenCalledWith('Resin', expect.any(String))
    expect(result.current.createdTags.map((t) => t.name)).toContain('Resin')
    expect(result.current.selectedTagIds).toContain(99)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/hooks/useImportStaging.test.ts`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement part 1** — `frontend/src/hooks/useImportStaging.ts`

```ts
import { useCallback, useMemo, useState } from 'react'
import type { Tag } from '../api/types'
import type { ModelDims, ThumbnailGenerator } from '../lib/thumbnail'
import { fileTypeFromName } from '../lib/thumbnail'
import { createTag, uploadFile, uploadThumbnail } from '../api/client'

export type StagingStatus =
  | 'parsing' | 'ready' | 'parse-error' | 'importing' | 'imported' | 'import-error'

export interface StagingItem {
  id: string
  file: File
  name: string
  status: StagingStatus
  error?: string
  sizeBytes: number
  dims?: ModelDims
  plateCount: number | null
  thumbnailUrl?: string
  thumbnailBlob?: Blob
}

export interface ImportStagingApi {
  uploadFile: typeof uploadFile
  uploadThumbnail: typeof uploadThumbnail
  createTag: typeof createTag
}

export interface UseImportStagingDeps {
  generate: ThumbnailGenerator
  api: ImportStagingApi
}

const AUTO_TAG_COLORS = ['orange', 'green', 'red', 'brass'] as const

let seq = 0
const nextId = () => `stg-${seq++}`

export function useImportStaging(deps: UseImportStagingDeps) {
  const { generate, api } = deps
  const [items, setItems] = useState<StagingItem[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const [importing, setImporting] = useState(false)

  const patch = useCallback((id: string, next: Partial<StagingItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)))
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      const newItems: StagingItem[] = files.map((file) => ({
        id: nextId(),
        file,
        name: file.name,
        status: fileTypeFromName(file.name) ? 'parsing' : 'parse-error',
        error: fileTypeFromName(file.name) ? undefined : 'Unsupported file type',
        sizeBytes: file.size,
        plateCount: null,
      }))
      setItems((prev) => [...prev, ...newItems])

      for (const item of newItems) {
        if (item.status !== 'parsing') continue
        generate(item.file)
          .then((res) => {
            patch(item.id, {
              status: 'ready',
              dims: res.dims,
              plateCount: res.plateCount,
              thumbnailBlob: res.pngBlob,
              thumbnailUrl: URL.createObjectURL(res.pngBlob),
            })
          })
          .catch(() => {
            patch(item.id, { status: 'parse-error', error: 'Couldn’t parse geometry — file may be corrupt' })
          })
      }
    },
    [generate, patch],
  )

  const toggleFolder = useCallback((id: number) => {
    setSelectedFolderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const toggleTag = useCallback((id: number) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const createAndSelectTag = useCallback(
    async (name: string) => {
      const color = AUTO_TAG_COLORS[(createdTags.length) % AUTO_TAG_COLORS.length]
      const tag = await api.createTag(name, color)
      setCreatedTags((prev) => [...prev, tag])
      setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]))
    },
    [api, createdTags.length],
  )

  const detectedCount = items.length
  const readyItems = useMemo(() => items.filter((it) => it.status === 'ready'), [items])
  const readyCount = readyItems.length
  const failedParseCount = useMemo(
    () => items.filter((it) => it.status === 'parse-error').length,
    [items],
  )
  const allDone = useMemo(
    () => items.length > 0 && items.every((it) => it.status === 'imported' || it.status === 'parse-error'),
    [items],
  )

  // importAll / retryFailed implemented in Task 4.
  const importAll = useCallback(async () => {}, [])
  const retryFailed = useCallback(async () => {}, [])

  return {
    items,
    addFiles,
    detectedCount,
    readyCount,
    failedParseCount,
    selectedFolderIds,
    toggleFolder,
    selectedTagIds,
    toggleTag,
    createdTags,
    createAndSelectTag,
    importAll,
    retryFailed,
    importing,
    allDone,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/useImportStaging.test.ts`
Expected: PASS (all five part-1 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useImportStaging.ts frontend/src/hooks/useImportStaging.test.ts
git commit -m "feat(import): staging hook add/parse and folder/tag selection"
```

---

## Task 4: Staging hook — commit + retry (`useImportStaging`, part 2)

**Files:**
- Modify: `frontend/src/hooks/useImportStaging.ts`
- Test: `frontend/src/hooks/useImportStaging.test.ts` (extend)

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: working `importAll()`, `retryFailed()`, `importing` flag; sequential commit; `imported`/`import-error` transitions.

- [ ] **Step 1: Write the failing tests** — append to `frontend/src/hooks/useImportStaging.test.ts`

```ts
describe('useImportStaging — commit', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  const addReady = async (result: { current: ReturnType<typeof useImportStaging> }, names: string[]) => {
    act(() => result.current.addFiles(names.map((n) => stlFile(n))))
    await waitFor(() => expect(result.current.readyCount).toBe(names.length))
  }

  it('imports ready files sequentially, passing folder/tag ids, then marks imported', async () => {
    const order: string[] = []
    const api = stubApi()
    api.uploadFile = vi.fn(async ({ file, folderIds, tagIds }) => {
      order.push(file.name)
      expect(folderIds).toEqual([2])
      expect(tagIds).toEqual([5])
      return { id: order.length } as never
    }) as ImportStagingApi['uploadFile']
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api }))
    await addReady(result, ['a.stl', 'b.stl'])
    act(() => { result.current.toggleFolder(2); result.current.toggleTag(5) })

    await act(async () => { await result.current.importAll() })

    expect(order).toEqual(['a.stl', 'b.stl'])
    expect(result.current.items.every((it) => it.status === 'imported')).toBe(true)
    expect(api.uploadThumbnail).toHaveBeenCalledTimes(2)
    expect(result.current.allDone).toBe(true)
  })

  it('keeps other files imported when one upload fails, then retries only the failure', async () => {
    const api = stubApi()
    let calls = 0
    api.uploadFile = vi.fn(async ({ file }) => {
      calls++
      if (file.name === 'bad.stl' && calls === 2) throw new Error('500')
      return { id: calls } as never
    }) as ImportStagingApi['uploadFile']
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api }))
    await addReady(result, ['good.stl', 'bad.stl'])

    await act(async () => { await result.current.importAll() })
    const statuses = () => result.current.items.map((it) => `${it.name}:${it.status}`)
    expect(statuses()).toEqual(['good.stl:imported', 'bad.stl:import-error'])

    await act(async () => { await result.current.retryFailed() })
    expect(result.current.items.find((it) => it.name === 'bad.stl')!.status).toBe('imported')
  })

  it('still marks imported when the thumbnail upload fails (non-fatal)', async () => {
    const api = stubApi()
    api.uploadThumbnail = vi.fn(async () => { throw new Error('thumb 500') }) as ImportStagingApi['uploadThumbnail']
    const { result } = renderHook(() => useImportStaging({ generate: okGenerate, api }))
    await addReady(result, ['a.stl'])
    await act(async () => { await result.current.importAll() })
    expect(result.current.items[0].status).toBe('imported')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/hooks/useImportStaging.test.ts`
Expected: FAIL — `importAll` is a no-op, so statuses stay `ready`.

- [ ] **Step 3: Replace the stub `importAll`/`retryFailed`** in `frontend/src/hooks/useImportStaging.ts`

Replace the two placeholder `useCallback` lines from Task 3 with:

```ts
  const commitOne = useCallback(
    async (item: StagingItem) => {
      patch(item.id, { status: 'importing', error: undefined })
      try {
        const created = await api.uploadFile({
          file: item.file,
          folderIds: selectedFolderIds,
          tagIds: selectedTagIds,
        })
        if (item.thumbnailBlob) {
          try {
            await api.uploadThumbnail(created.id, item.thumbnailBlob)
          } catch {
            // thumbnail is non-fatal: the file is imported regardless
          }
        }
        patch(item.id, { status: 'imported' })
      } catch {
        patch(item.id, { status: 'import-error', error: 'Upload failed' })
      }
    },
    [api, patch, selectedFolderIds, selectedTagIds],
  )

  const commitBatch = useCallback(
    async (targets: StagingItem[]) => {
      setImporting(true)
      try {
        for (const item of targets) {
          await commitOne(item)
        }
      } finally {
        setImporting(false)
      }
    },
    [commitOne],
  )

  const importAll = useCallback(
    () => commitBatch(items.filter((it) => it.status === 'ready')),
    [commitBatch, items],
  )

  const retryFailed = useCallback(
    () => commitBatch(items.filter((it) => it.status === 'import-error')),
    [commitBatch, items],
  )
```

> `commitOne` reads `item.thumbnailBlob`/`item.file` from the argument, and folder/tag ids from state — it must be defined after `patch`, `selectedFolderIds`, `selectedTagIds` already exist (they do, from Task 3). Keep the `return { ... }` object unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/useImportStaging.test.ts`
Expected: PASS (part-1 and part-2 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useImportStaging.ts frontend/src/hooks/useImportStaging.test.ts
git commit -m "feat(import): sequential commit with partial-failure retry in staging hook"
```

---

## Task 5: DropZone component

**Files:**
- Create: `frontend/src/components/import/DropZone.tsx`, `frontend/src/components/import/DropZone.module.css`
- Test: `frontend/src/components/import/DropZone.test.tsx`

**Interfaces:**
- Produces: `function DropZone(props: { onFiles: (files: File[]) => void; disabled?: boolean }): JSX.Element`

- [ ] **Step 1: Write the failing test** — `frontend/src/components/import/DropZone.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

describe('DropZone', () => {
  it('calls onFiles with dropped files', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} />)
    const file = new File([new Uint8Array([1])], 'a.stl')
    const zone = screen.getByText(/drop 3mf/i).closest('div')!
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('calls onFiles from the file input', () => {
    const onFiles = vi.fn()
    const { container } = render(<DropZone onFiles={onFiles} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1])], 'b.3mf')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('does not fire when disabled', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} disabled />)
    const file = new File([new Uint8Array([1])], 'a.stl')
    const zone = screen.getByText(/drop 3mf/i).closest('div')!
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/import/DropZone.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement** — `frontend/src/components/import/DropZone.tsx`

```tsx
import { useRef, useState } from 'react'
import styles from './DropZone.module.css'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export function DropZone({ onFiles, disabled = false }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      className={`${styles.zone} ${over ? styles.over : ''} ${disabled ? styles.disabled : ''}`}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
      onClick={() => { if (!disabled) inputRef.current?.click() }}
    >
      <div className={styles.icon} aria-hidden>⬇</div>
      <div className={styles.title}>Drop 3MF / STL files here, or click to browse</div>
      <div className={styles.sub}>Metadata (dimensions, plates) is parsed automatically</div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".3mf,.stl"
        hidden
        onChange={(e) => { emit(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Create styles** — `frontend/src/components/import/DropZone.module.css`

```css
.zone {
  border: 1.5px dashed rgba(255, 255, 255, 0.18);
  border-radius: 9px;
  padding: 28px 20px;
  text-align: center;
  cursor: pointer;
  background: var(--bg-surface);
}
.over { border-color: var(--accent); background: var(--accent-tint); }
.disabled { opacity: 0.5; cursor: not-allowed; }
.icon {
  width: 44px; height: 44px; margin: 0 auto 10px;
  display: grid; place-items: center;
  background: var(--accent); color: var(--accent-text);
  border-radius: 9px; font-size: 20px;
}
.title { color: var(--text-primary); font-size: 13px; font-weight: 600; }
.sub { color: var(--text-secondary); font-size: 11px; margin-top: 4px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/import/DropZone.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/import/DropZone.tsx frontend/src/components/import/DropZone.module.css frontend/src/components/import/DropZone.test.tsx
git commit -m "feat(import): DropZone drag-and-drop + browse component"
```

---

## Task 6: StagingRow component

**Files:**
- Create: `frontend/src/components/import/StagingRow.tsx`, `frontend/src/components/import/StagingRow.module.css`
- Test: `frontend/src/components/import/StagingRow.test.tsx`

**Interfaces:**
- Consumes: `StagingItem` from `../../hooks/useImportStaging`; `formatBytes`, `formatDimensions` from `../../lib/format`.
- Produces: `function StagingRow(props: { item: StagingItem }): JSX.Element`

- [ ] **Step 1: Write the failing test** — `frontend/src/components/import/StagingRow.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StagingRow } from './StagingRow'
import type { StagingItem } from '../../hooks/useImportStaging'

const base: StagingItem = {
  id: 's1', file: new File([new Uint8Array([1])], 'Cable_Clip.stl'), name: 'Cable_Clip.stl',
  status: 'ready', sizeBytes: 800_000, dims: { x: 42, y: 18, z: 12 }, plateCount: null,
}

describe('StagingRow', () => {
  it('shows name, dims and size for a ready file', () => {
    render(<StagingRow item={base} />)
    expect(screen.getByText('Cable_Clip.stl')).toBeInTheDocument()
    expect(screen.getByText(/42 × 18 × 12 mm/)).toBeInTheDocument()
    expect(screen.getByText(/781\.2 KB/)).toBeInTheDocument()
    expect(screen.getByText(/parsed/i)).toBeInTheDocument()
  })

  it('shows the error text for a parse-error file', () => {
    render(<StagingRow item={{ ...base, status: 'parse-error', dims: undefined, error: 'Couldn’t parse geometry' }} />)
    expect(screen.getByText(/couldn.t parse geometry/i)).toBeInTheDocument()
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })

  it('appends plate count for a 3mf', () => {
    render(<StagingRow item={{ ...base, name: 'Plate.3mf', plateCount: 3 }} />)
    expect(screen.getByText(/3 plates/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/import/StagingRow.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement** — `frontend/src/components/import/StagingRow.tsx`

```tsx
import type { StagingItem } from '../../hooks/useImportStaging'
import { formatBytes, formatDimensions } from '../../lib/format'
import styles from './StagingRow.module.css'

const STATUS_LABEL: Record<StagingItem['status'], string> = {
  parsing: 'parsing…',
  ready: '✓ parsed',
  'parse-error': '✕ error',
  importing: 'importing…',
  imported: '✓ imported',
  'import-error': '✕ failed',
}

function metaLine(item: StagingItem): string {
  if (item.status === 'parse-error' || item.status === 'import-error') {
    return item.error ?? 'Something went wrong'
  }
  const parts: string[] = []
  const dims = item.dims ? formatDimensions(item.dims.x, item.dims.y, item.dims.z) : null
  if (dims) parts.push(dims)
  parts.push(formatBytes(item.sizeBytes))
  if (item.plateCount && item.plateCount > 1) parts.push(`${item.plateCount} plates`)
  return parts.join(' · ')
}

export function StagingRow({ item }: { item: StagingItem }) {
  const bad = item.status === 'parse-error' || item.status === 'import-error'
  return (
    <div className={styles.row}>
      <div className={styles.thumb} aria-hidden>
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className={styles.img} /> : null}
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{item.name}</div>
        <div className={`${styles.meta} ${bad ? styles.metaBad : ''}`}>{metaLine(item)}</div>
      </div>
      <div className={`${styles.status} ${bad ? styles.statusBad : styles.statusOk}`}>
        {STATUS_LABEL[item.status]}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create styles** — `frontend/src/components/import/StagingRow.module.css`

```css
.row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px;
  background: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9px;
}
.thumb {
  width: 44px; height: 44px; flex: none; border-radius: 6px; overflow: hidden;
  background: repeating-linear-gradient(135deg, #241f1a, #241f1a 8px, #2b241e 8px, #2b241e 16px);
}
.img { width: 100%; height: 100%; object-fit: cover; }
.info { flex: 1; min-width: 0; }
.name { color: var(--text-primary); font-size: 13px; font-weight: 600; }
.meta { color: var(--text-secondary); font-family: var(--font-mono); font-size: 11px; margin-top: 2px; }
.metaBad { color: var(--error); }
.status { font-family: var(--font-mono); font-size: 11px; flex: none; }
.statusOk { color: var(--success); }
.statusBad { color: var(--error); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/import/StagingRow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/import/StagingRow.tsx frontend/src/components/import/StagingRow.module.css frontend/src/components/import/StagingRow.test.tsx
git commit -m "feat(import): StagingRow file preview row"
```

---

## Task 7: ImportAssignPanel component

**Files:**
- Create: `frontend/src/components/import/ImportAssignPanel.tsx`, `frontend/src/components/import/ImportAssignPanel.module.css`
- Test: `frontend/src/components/import/ImportAssignPanel.test.tsx`

**Interfaces:**
- Consumes: `Folder`, `Tag` from `../../api/types`; `tagColor` from `../../lib/format`.
- Produces:
```ts
function ImportAssignPanel(props: {
  folders: Folder[]
  tags: Tag[]              // existing + created, merged by the caller
  selectedFolderIds: number[]
  onToggleFolder: (id: number) => void
  selectedTagIds: number[]
  onToggleTag: (id: number) => void
  onCreateTag: (name: string) => void
  detectedCount: number
  readyCount: number
  failedParseCount: number
  importing: boolean
  onImport: () => void
}): JSX.Element
```

- [ ] **Step 1: Write the failing test** — `frontend/src/components/import/ImportAssignPanel.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImportAssignPanel } from './ImportAssignPanel'
import type { Folder, Tag } from '../../api/types'

const folders: Folder[] = [
  { id: 3, name: 'To Print', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: true },
]
const tags: Tag[] = [{ id: 7, name: 'Resin', colorKey: 'orange' }]

const props = () => ({
  folders, tags,
  selectedFolderIds: [] as number[], onToggleFolder: vi.fn(),
  selectedTagIds: [] as number[], onToggleTag: vi.fn(),
  onCreateTag: vi.fn(),
  detectedCount: 6, readyCount: 5, failedParseCount: 1,
  importing: false, onImport: vi.fn(),
})

describe('ImportAssignPanel', () => {
  it('labels the import button with the ready count', () => {
    render(<ImportAssignPanel {...props()} />)
    expect(screen.getByRole('button', { name: /import 5 files/i })).toBeEnabled()
  })

  it('warns when some files failed to parse', () => {
    render(<ImportAssignPanel {...props()} />)
    expect(screen.getByText(/1 file.*couldn.t be parsed.*import the other 5/i)).toBeInTheDocument()
  })

  it('disables import when nothing is ready', () => {
    render(<ImportAssignPanel {...{ ...props(), readyCount: 0 }} />)
    expect(screen.getByRole('button', { name: /import 0 files/i })).toBeDisabled()
  })

  it('offers to create a tag when the query matches nothing', () => {
    const p = props()
    render(<ImportAssignPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/add a tag/i), { target: { value: 'Nylon' } })
    fireEvent.click(screen.getByText(/create .*nylon/i))
    expect(p.onCreateTag).toHaveBeenCalledWith('Nylon')
  })

  it('toggles an existing folder from the search results', () => {
    const p = props()
    render(<ImportAssignPanel {...p} />)
    fireEvent.change(screen.getByPlaceholderText(/search or pick a folder/i), { target: { value: 'To' } })
    fireEvent.click(screen.getByText('To Print'))
    expect(p.onToggleFolder).toHaveBeenCalledWith(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/import/ImportAssignPanel.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement** — `frontend/src/components/import/ImportAssignPanel.tsx`

```tsx
import { useState } from 'react'
import type { Folder, Tag } from '../../api/types'
import { tagColor } from '../../lib/format'
import styles from './ImportAssignPanel.module.css'

interface Props {
  folders: Folder[]
  tags: Tag[]
  selectedFolderIds: number[]
  onToggleFolder: (id: number) => void
  selectedTagIds: number[]
  onToggleTag: (id: number) => void
  onCreateTag: (name: string) => void
  detectedCount: number
  readyCount: number
  failedParseCount: number
  importing: boolean
  onImport: () => void
}

export function ImportAssignPanel(props: Props) {
  const [folderQuery, setFolderQuery] = useState('')
  const [tagQuery, setTagQuery] = useState('')

  const folderMatches = props.folders.filter(
    (f) => !props.selectedFolderIds.includes(f.id) && f.name.toLowerCase().includes(folderQuery.trim().toLowerCase()),
  )
  const tagMatches = props.tags.filter(
    (t) => !props.selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(tagQuery.trim().toLowerCase()),
  )
  const trimmedTag = tagQuery.trim()
  const exactTag = props.tags.some((t) => t.name.toLowerCase() === trimmedTag.toLowerCase())
  const selectedFolders = props.folders.filter((f) => props.selectedFolderIds.includes(f.id))
  const selectedTags = props.tags.filter((t) => props.selectedTagIds.includes(t.id))

  return (
    <aside className={styles.panel}>
      <div className={styles.label}>ADD ALL TO FOLDER</div>
      <input
        className={styles.input}
        placeholder="Search or pick a folder…"
        value={folderQuery}
        onChange={(e) => setFolderQuery(e.target.value)}
      />
      {folderQuery.trim() && folderMatches.length > 0 ? (
        <ul className={styles.results}>
          {folderMatches.map((f) => (
            <li key={f.id}>
              <button className={styles.result} onClick={() => { props.onToggleFolder(f.id); setFolderQuery('') }}>
                {f.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.pills}>
        {selectedFolders.map((f) => (
          <button key={f.id} className={styles.pill} onClick={() => props.onToggleFolder(f.id)}>
            {f.name} ✕
          </button>
        ))}
      </div>

      <div className={styles.label}>TAGS FOR ALL</div>
      <input
        className={styles.input}
        placeholder="Add a tag…"
        value={tagQuery}
        onChange={(e) => setTagQuery(e.target.value)}
      />
      {trimmedTag ? (
        <ul className={styles.results}>
          {tagMatches.map((t) => (
            <li key={t.id}>
              <button className={styles.result} onClick={() => { props.onToggleTag(t.id); setTagQuery('') }}>
                {t.name}
              </button>
            </li>
          ))}
          {!exactTag ? (
            <li>
              <button className={styles.result} onClick={() => { props.onCreateTag(trimmedTag); setTagQuery('') }}>
                Create “{trimmedTag}”
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className={styles.pills}>
        {selectedTags.map((t) => (
          <button
            key={t.id}
            className={styles.pill}
            style={{ color: tagColor(t.colorKey) }}
            onClick={() => props.onToggleTag(t.id)}
          >
            {t.name} ✕
          </button>
        ))}
      </div>

      {props.failedParseCount > 0 ? (
        <div className={styles.warn}>
          {props.failedParseCount} file{props.failedParseCount > 1 ? 's' : ''} couldn’t be parsed — import the other {props.readyCount}.
        </div>
      ) : null}

      <button
        className={styles.importBtn}
        disabled={props.readyCount === 0 || props.importing}
        onClick={props.onImport}
      >
        {props.importing ? 'Importing…' : `Import ${props.readyCount} files`}
      </button>
    </aside>
  )
}
```

- [ ] **Step 4: Create styles** — `frontend/src/components/import/ImportAssignPanel.module.css`

```css
.panel { width: 280px; flex: none; padding: 20px; background: var(--bg-panel); border-left: 1px solid rgba(255, 255, 255, 0.08); overflow-y: auto; }
.label { color: var(--text-tertiary); font-size: 10px; letter-spacing: 0.08em; font-weight: 600; margin: 18px 0 8px; }
.label:first-child { margin-top: 0; }
.input { width: 100%; box-sizing: border-box; background: var(--bg-surface); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 7px; color: var(--text-primary); font-size: 13px; padding: 8px 10px; }
.results { list-style: none; margin: 6px 0 0; padding: 0; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 7px; overflow: hidden; }
.result { display: block; width: 100%; text-align: left; background: var(--bg-surface); color: var(--text-primary); border: none; padding: 8px 10px; font-size: 13px; cursor: pointer; }
.result:hover { background: var(--accent-tint); }
.pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pill { background: var(--bg-surface); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 99px; color: var(--text-primary); font-size: 11px; padding: 4px 10px; cursor: pointer; }
.warn { color: var(--text-secondary); font-size: 11px; margin: 16px 0 8px; }
.importBtn { width: 100%; margin-top: 16px; background: var(--accent); color: var(--accent-text); border: none; border-radius: 7px; font-size: 13px; font-weight: 600; padding: 10px; cursor: pointer; }
.importBtn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/import/ImportAssignPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/import/ImportAssignPanel.tsx frontend/src/components/import/ImportAssignPanel.module.css frontend/src/components/import/ImportAssignPanel.test.tsx
git commit -m "feat(import): ImportAssignPanel folder/tag assignment + import button"
```

---

## Task 8: ImportView (compose the screen)

**Files:**
- Create: `frontend/src/views/ImportView.tsx`, `frontend/src/views/ImportView.module.css`
- Test: `frontend/src/views/ImportView.test.tsx`

**Interfaces:**
- Consumes: `useImportStaging` + `ImportStagingApi`/`UseImportStagingDeps`; `generateThumbnail`; `uploadFile`/`uploadThumbnail`/`createTag`; `useFolders`, `useTags`; `DropZone`, `StagingRow`, `ImportAssignPanel`.
- Produces:
```ts
function ImportView(props: {
  onBack: () => void
  onImported: () => void
  deps?: UseImportStagingDeps   // defaults to the real generator + api; injected in tests
}): JSX.Element
```

- [ ] **Step 1: Write the failing test** — `frontend/src/views/ImportView.test.tsx`

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportView } from './ImportView'
import type { UseImportStagingDeps } from '../hooks/useImportStaging'
import type { ThumbnailGenerator } from '../lib/thumbnail'

const folders = [{ id: 3, name: 'To Print', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: true }]
const tags = [{ id: 7, name: 'Resin', colorKey: 'orange' }]

const generate: ThumbnailGenerator = async () => ({
  pngBlob: new Blob([new Uint8Array([0])], { type: 'image/png' }), dims: { x: 1, y: 2, z: 3 }, plateCount: null,
})
const deps = (): UseImportStagingDeps => ({
  generate,
  api: {
    uploadFile: vi.fn(async () => ({ id: 1 })) as UseImportStagingDeps['api']['uploadFile'],
    uploadThumbnail: vi.fn(async () => ({ id: 1 })) as UseImportStagingDeps['api']['uploadThumbnail'],
    createTag: vi.fn(async (n: string, c: string | null) => ({ id: 9, name: n, colorKey: c })) as UseImportStagingDeps['api']['createTag'],
  },
})

describe('ImportView', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const body = String(url).includes('/api/folders') ? folders : String(url).includes('/api/tags') ? tags : []
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('adds a dropped file, shows a ready row, imports, and calls onImported', async () => {
    const onImported = vi.fn()
    render(<ImportView onBack={vi.fn()} onImported={onImported} deps={deps()} />)
    const file = new File([new Uint8Array([1])], 'a.stl')
    const zone = screen.getByText(/drop 3mf/i).closest('div')!
    act(() => { fireEvent.drop(zone, { dataTransfer: { files: [file] } }) })
    await waitFor(() => expect(screen.getByText('a.stl')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /import 1 files/i })).toBeEnabled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /import 1 files/i })) })
    await waitFor(() => expect(onImported).toHaveBeenCalled())
  })

  it('calls onBack from the cancel control', () => {
    const onBack = vi.fn()
    render(<ImportView onBack={onBack} onImported={vi.fn()} deps={deps()} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/views/ImportView.test.tsx`
Expected: FAIL — view missing.

- [ ] **Step 3: Implement** — `frontend/src/views/ImportView.tsx`

```tsx
import { useEffect, useMemo } from 'react'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { useImportStaging, type UseImportStagingDeps } from '../hooks/useImportStaging'
import { generateThumbnail } from '../lib/thumbnail'
import { uploadFile, uploadThumbnail, createTag } from '../api/client'
import { DropZone } from '../components/import/DropZone'
import { StagingRow } from '../components/import/StagingRow'
import { ImportAssignPanel } from '../components/import/ImportAssignPanel'
import styles from './ImportView.module.css'

const DEFAULT_DEPS: UseImportStagingDeps = {
  generate: generateThumbnail,
  api: { uploadFile, uploadThumbnail, createTag },
}

interface ImportViewProps {
  onBack: () => void
  onImported: () => void
  deps?: UseImportStagingDeps
}

export function ImportView({ onBack, onImported, deps = DEFAULT_DEPS }: ImportViewProps) {
  const { folders } = useFolders()
  const { tags } = useTags()
  const staging = useImportStaging(deps)

  const mergedTags = useMemo(() => [...tags, ...staging.createdTags], [tags, staging.createdTags])

  useEffect(() => {
    if (staging.allDone && !staging.importing) onImported()
  }, [staging.allDone, staging.importing, onImported])

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Import files</h1>
        <span className={styles.counts}>
          {staging.detectedCount} detected · {staging.readyCount} ready
        </span>
        <button className={styles.cancel} onClick={onBack}>Cancel</button>
      </header>
      <div className={styles.body}>
        <main className={styles.main}>
          <DropZone onFiles={staging.addFiles} disabled={staging.importing} />
          <div className={styles.list}>
            {staging.items.map((item) => (
              <StagingRow key={item.id} item={item} />
            ))}
          </div>
        </main>
        <ImportAssignPanel
          folders={folders}
          tags={mergedTags}
          selectedFolderIds={staging.selectedFolderIds}
          onToggleFolder={staging.toggleFolder}
          selectedTagIds={staging.selectedTagIds}
          onToggleTag={staging.toggleTag}
          onCreateTag={(name) => { void staging.createAndSelectTag(name) }}
          detectedCount={staging.detectedCount}
          readyCount={staging.readyCount}
          failedParseCount={staging.failedParseCount}
          importing={staging.importing}
          onImport={() => { void staging.importAll() }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create styles** — `frontend/src/views/ImportView.module.css`

```css
.view { display: flex; flex-direction: column; height: 100%; background: var(--bg-app); }
.header { display: flex; align-items: baseline; gap: 12px; padding: 18px 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.title { color: var(--text-primary); font-size: 18px; font-weight: 700; margin: 0; }
.counts { color: var(--text-secondary); font-family: var(--font-mono); font-size: 11px; }
.cancel { margin-left: auto; background: transparent; border: 1px solid rgba(255, 255, 255, 0.08); color: var(--text-primary); border-radius: 7px; font-size: 13px; padding: 6px 14px; cursor: pointer; }
.body { flex: 1; display: flex; min-height: 0; }
.main { flex: 1; overflow-y: auto; padding: 20px; }
.list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/views/ImportView.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/ImportView.tsx frontend/src/views/ImportView.module.css frontend/src/views/ImportView.test.tsx
git commit -m "feat(import): compose ImportView (drop zone + staging list + assign panel)"
```

---

## Task 9: Extract LibraryView + Sidebar Import button + App shell

**Files:**
- Create: `frontend/src/views/LibraryView.tsx`, `frontend/src/views/LibraryView.module.css`
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/Sidebar.test.tsx`, `frontend/src/App.test.tsx`
- Delete: `frontend/src/App.module.css` (content moves to `LibraryView.module.css`)

**Interfaces:**
- Produces: `function LibraryView(props: { onImport: () => void }): JSX.Element`; `Sidebar` gains `onImport: () => void`; `App` renders a `'library' | 'import'` shell.

- [ ] **Step 1: Add the Import button to Sidebar — write the failing test** (append to `frontend/src/components/Sidebar.test.tsx`)

```tsx
it('renders an Import button that calls onImport', () => {
  const onImport = vi.fn()
  render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={onImport} />)
  fireEvent.click(screen.getByRole('button', { name: /import/i }))
  expect(onImport).toHaveBeenCalled()
})
```

Also update the three existing `Sidebar` renders in this file to pass `onImport={vi.fn()}` so the new required prop is satisfied.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — `onImport` not a prop / no Import button.

- [ ] **Step 3: Add the prop + button to `Sidebar.tsx`**

Add `onImport: () => void` to the `Sidebar` props type, and render a button in the sidebar header (near the top, above the tree). Example — add at the start of the sidebar's returned markup:

```tsx
<button type="button" className={styles.importButton} onClick={onImport}>
  ⬆ Import files
</button>
```

Add to `Sidebar.module.css`:

```css
.importButton { display: block; width: calc(100% - 24px); margin: 12px; background: var(--accent); color: var(--accent-text); border: none; border-radius: 7px; font-size: 13px; font-weight: 600; padding: 8px; cursor: pointer; }
```

(Class name `importButton` must match; adapt to the existing Sidebar structure/class conventions.)

- [ ] **Step 4: Run to verify Sidebar passes**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Create `LibraryView.tsx` by moving the body out of `App.tsx`**

Create `frontend/src/views/LibraryView.tsx` containing exactly what `App.tsx` renders today, plus the `onImport` prop wired into `Sidebar`. Move `App.module.css` to `frontend/src/views/LibraryView.module.css` (identical content) and import it here:

```tsx
import { useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { FileGrid } from '../components/FileGrid'
import { FileDetailPanel } from '../components/FileDetailPanel'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { useFiles } from '../hooks/useFiles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import styles from './LibraryView.module.css'

export function LibraryView({ onImport }: { onImport: () => void }) {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const { folders } = useFolders()
  const { tags } = useTags()
  const { files, loading, error } = useFiles(selectedFolderId, debouncedSearch)

  const title =
    selectedFolderId === null
      ? 'All Files'
      : (folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder')
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

  let center
  if (loading) {
    center = <div className={styles.status}>Loading…</div>
  } else if (error) {
    center = <div className={styles.status}>Could not load files. Is the backend running?</div>
  } else if (files.length === 0) {
    center = (
      <div className={styles.status}>
        {debouncedSearch.trim() ? 'No files match your search' : 'No files in this view'}
      </div>
    )
  } else {
    center = (
      <FileGrid files={files} tags={tags} selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} />
    )
  }

  return (
    <div className={styles.app}>
      <Sidebar folders={folders} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onImport={onImport} />
      <main className={styles.center}>
        <LibraryToolbar title={title} fileCount={files.length} search={search} onSearchChange={setSearch} />
        <div className={styles.centerBody}>{center}</div>
      </main>
      <FileDetailPanel file={selectedFile} folders={folders} tags={tags} />
    </div>
  )
}
```

Run: `git mv frontend/src/App.module.css frontend/src/views/LibraryView.module.css`

- [ ] **Step 6: Rewrite `App.tsx` as the shell**

```tsx
import { useState } from 'react'
import { LibraryView } from './views/LibraryView'
import { ImportView } from './views/ImportView'

export default function App() {
  const [view, setView] = useState<'library' | 'import'>('library')
  const [libraryKey, setLibraryKey] = useState(0)

  if (view === 'import') {
    return (
      <ImportView
        onBack={() => setView('library')}
        onImported={() => { setLibraryKey((k) => k + 1); setView('library') }}
      />
    )
  }
  return <LibraryView key={libraryKey} onImport={() => setView('import')} />
}
```

- [ ] **Step 7: Update `App.test.tsx`** — keep the existing three tests (they still pass through `App` → `LibraryView`), and add view-toggle coverage. Append:

```tsx
it('switches to the import view when Import is clicked, and back on cancel', async () => {
  render(<App />)
  await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /import files/i }))
  await waitFor(() => expect(screen.getByText(/drop 3mf/i)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
  await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
})
```

> The existing `mockApi` in `App.test.tsx` already answers `/api/folders`, `/api/tags`, `/api/files`, which is all `ImportView` needs on mount. No mock changes required.

- [ ] **Step 8: Run the full suite + typecheck**

Run: `cd frontend && npm test && npx tsc -b`
Expected: all suites PASS; `tsc -b` exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/views/LibraryView.tsx frontend/src/views/LibraryView.module.css frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css frontend/src/components/Sidebar.test.tsx
git commit -m "feat(import): extract LibraryView and add import view toggle + Sidebar Import button"
```

---

## Task 10: End-to-end verification (run the app)

**Files:** none (verification only). This task has no committed test; it is the manual gate that the WebGL render and the real import round-trip actually work — the one thing jsdom cannot cover.

- [ ] **Step 1: Ensure both servers are running**

Backend on `:5102` (with `SEED_SAMPLE_DATA=true`), Vite on `:5173` (proxy → `127.0.0.1:5102`). If not running, start per `README.md`. Confirm: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/folders` → `200`.

- [ ] **Step 2: Prepare two real test files**

Use any real `.stl` and `.3mf` you have, or generate a minimal valid binary `.stl` (a few triangles) so Three.js can render it. Place them somewhere easy to pick.

- [ ] **Step 3: Drive the flow in a browser (or via `/run`)**

Open `http://localhost:5173`, click **Import files**. Drag both files onto the drop zone. Verify:
- Each row shows a **rendered thumbnail** (not the stripe placeholder), the name, and a `dims · size` line (`· N plates` for the 3MF).
- A deliberately corrupt/renamed file shows a red `✕ error` with the parse message and is excluded from the ready count.
- In the panel, assign a folder and **create a new tag**; both appear as pills.

- [ ] **Step 4: Commit the import and confirm the round-trip**

Click **Import N files**. Verify rows go to `✓ imported`, the view returns to the library, and the newly imported files appear — in the assigned folder, with their tag. Confirm on the backend:
```bash
curl -s http://localhost:5102/api/files | grep -o '"thumbnailPath":"[^"]*"' | tail -2
```
Expected: the newly imported files have a non-null `thumbnailPath` (thumbnail stored).

- [ ] **Step 5: Confirm partial-failure recovery (optional but recommended)**

Stop the backend, attempt an import, confirm rows show `✕ failed` and the button becomes **Retry N failed**; restart the backend and click retry; confirm they import.

- [ ] **Step 6: Final full test run**

Run: `cd frontend && npm test` → all PASS. `cd ../backend && dotnet test` → all PASS (no backend changes expected; this guards against the Task 2 binding edit if it was needed).

- [ ] **Step 7: Record any surprises**

If Task 2 required the `[FromForm(Name=...)]` backend edit, or if you had to install/patch anything not in this plan, note it in the final commit and recommend `/run-skill-generator` to capture app-launch specifics.

---

## Self-Review

**Spec coverage:**
- Drag-and-drop + click-to-browse → Task 5 (DropZone). ✓
- Client-side Three.js load + hidden canvas → PNG → Task 1 (`renderToPng`/`generateThumbnail`). ✓
- Per-file parse status pending→✓/✕ → Task 3 (`parsing`/`ready`/`parse-error`) + Task 6 (StagingRow badges). ✓
- Right panel folder + tags for all, inline tag creation w/ auto color → Task 7 + Task 3 (`createAndSelectTag`, `AUTO_TAG_COLORS`). ✓
- "Import N files" commits file + thumbnail + metadata; failed excluded → Task 4 (`importAll`, ready-only) + Task 2 (client). ✓
- Sequential commit, partial success, non-fatal thumbnail, retry → Task 4. ✓
- Warning when some failed to parse → Task 7 (`failedParseCount` line). ✓
- View-toggle entry, LibraryView extraction, nav callbacks → Task 9. ✓
- Server authoritative / no dims sent / no print time → Task 2 (client sends only file+ids), Task 6 (metaLine has no print time). ✓
- `three`/`fflate` deps → Task 1. ✓
- Multipart binding verification → Task 2 Step 6. ✓
- WebGL render verified by running → Task 10. ✓

**Placeholder scan:** No TBD/TODO/"handle errors" left; every code step is complete. The only intentional no-ops are Task 3's `importAll`/`retryFailed` stubs, explicitly replaced in Task 4.

**Type consistency:** `StagingItem`, `ThumbnailResult`, `ModelDims`, `ThumbnailGenerator`, `ImportStagingApi`, `UseImportStagingDeps`, `UploadFileInput` are defined once and referenced with the same shapes across tasks. `uploadFile` takes `{ file, folderIds, tagIds }` in Task 2 and is called that way in Task 4. `ImportAssignPanel` prop names match `ImportView`'s usage in Task 8. `Sidebar`'s new `onImport` is required in Task 9 and every render site is updated.
