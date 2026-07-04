export type ModelFileType = 'ThreeMf' | 'Stl'

export interface ModelFile {
  id: number
  name: string
  type: ModelFileType
  sizeBytes: number
  addedAt: string
  dimXMm: number | null
  dimYMm: number | null
  dimZMm: number | null
  plateCount: number | null
  estPrintTimeMin: number | null
  material: string | null
  layerHeightMm: number | null
  sourceUrl: string | null
  creator: string | null
  description: string | null
  thumbnailPath: string | null
  folderIds: number[]
  tagIds: number[]
}

export interface Folder {
  id: number
  name: string
  parentId: number | null
  description: string | null
  coverImageFileId: number | null
  sortOrder: number
  isSystem: boolean
}

export interface Tag {
  id: number
  name: string
  colorKey: string | null
}

export interface UploadFileInput {
  file: File
  folderIds: number[]
  tagIds: number[]
}
