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
