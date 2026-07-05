# PlasticRoom

A Lightroom-style web app for organizing 3MF/STL 3D-printer files.

## Running

```bash
docker-compose up --build
```

The frontend is served on the mapped Nginx port; the backend API is proxied under `/api`.

## Development

Backend: `cd backend && dotnet run --project PlasticRoom.Api`
Frontend: `cd frontend && npm install && npm run dev`

### Sample data (development only)

The app auto-seeds the system collections (Favorites, Printed, To Print, Failed Prints)
on every start. To also populate example folders, tags, and parsed sample `.3mf`/`.stl`
files so the Library UI has content to render, set the `SEED_SAMPLE_DATA` environment
variable before starting the backend:

```bash
SEED_SAMPLE_DATA=true dotnet run --project PlasticRoom.Api   # bash
$env:SEED_SAMPLE_DATA = "true"; dotnet run --project PlasticRoom.Api   # PowerShell
```

Seeding is idempotent: it is skipped if any non-system folder already exists, so it
runs only against a fresh database.

### Bambu plate metadata

3MF files sliced in Bambu Studio carry real print-plate data (`Metadata/model_settings.config`).
On import, PlasticRoom records each plate (name, embedded thumbnail, object grouping) and the
detail view's filmstrip shows those plates. **Files imported before this feature must be
re-imported** to gain plate data; until then they fall back to one cell per 3MF build item.
