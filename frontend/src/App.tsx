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
