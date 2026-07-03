# Phase 1 — Scaffolding & Docker

**Date:** 2026-07-02  
**Status:** Spec approved, implementation not started  
**Parent:** [Project Overview](2026-07-02-plastic-room-project-overview.md)

---

## Goal

A working, containerized skeleton — both services running in Docker, talking to each other, with a verified SQLite connection. Nothing visual beyond a status page.

## Deliverables

1. `frontend/` — Vite + React + TypeScript scaffold
2. `backend/` — ASP.NET Core 8 Web API project (`PlasticRoom.Api`)
3. `docker-compose.yml` — wires both containers + `plasticroom-data` volume
4. `frontend/Dockerfile` — Node build → Nginx alpine; proxies `/api/*` to backend
5. `backend/Dockerfile` — ASP.NET runtime image; volume at `/data`
6. XPO session factory connected to `/data/plasticroom.db`
7. `GET /api/health` → `{ "status": "ok", "db": "connected" }`
8. `App.tsx` smoke test — fetches `/api/health`, renders Connected/Disconnected

---

## Project Structure

```
PlasticRoom/
├── frontend/
│   ├── src/
│   │   └── App.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile
├── backend/
│   ├── PlasticRoom.Api/
│   │   ├── Controllers/
│   │   │   └── HealthController.cs
│   │   ├── Data/
│   │   │   └── XpoSessionFactory.cs
│   │   ├── PlasticRoom.Api.csproj
│   │   └── Program.cs
│   └── PlasticRoom.sln
├── docker-compose.yml
├── .gitignore
└── docs/
```

---

## Docker

### `docker-compose.yml`
- `frontend` service: builds from `./frontend/Dockerfile`, exposes port `3000` on host
- `backend` service: builds from `./backend/Dockerfile`, internal port `5000`, mounts `plasticroom-data` volume at `/data`
- Named volume `plasticroom-data` for persistence across rebuilds
- `frontend` depends on `backend`

### `frontend/Dockerfile`
```
Stage 1 (build): node:20-alpine — npm ci && npm run build
Stage 2 (serve): nginx:alpine — copy dist + nginx.conf
```

`nginx.conf` proxies `/api/` to `http://backend:5000/api/` so the browser never calls the backend directly.

### `backend/Dockerfile`
```
Stage 1 (build): mcr.microsoft.com/dotnet/sdk:8.0 — dotnet publish
Stage 2 (runtime): mcr.microsoft.com/dotnet/aspnet:8.0
```

Environment variable `DATA_PATH` defaults to `/data`; used by XPO session factory for the SQLite path.

---

## Backend

### `Program.cs`
- Registers XPO session factory as a singleton
- Registers controllers
- Configures CORS: allow any origin (development-friendly; tighten in future phases)
- Maps controller routes

### `XpoSessionFactory.cs`
- Reads `DATA_PATH` env var (default: `/data`)
- Creates directory if it doesn't exist
- Builds XPO `XpoDefault.DataLayer` with SQLite connection string pointing at `{DATA_PATH}/plasticroom.db`
- Exposes a `CreateSession()` method that returns an `XPO.Session`
- No entities yet — just verifies the connection opens without error

### `HealthController.cs`
- Route: `GET /api/health`
- Opens an XPO session, runs a trivial query (or just opens and closes), returns:
  ```json
  { "status": "ok", "db": "connected" }
  ```
- On exception returns HTTP 503 with `{ "status": "error", "db": "failed", "detail": "<message>" }`

---

## Frontend

### `vite.config.ts`
- Dev server proxy: `/api` → `http://localhost:5000` (for local dev without Docker)

### `App.tsx`
- `useEffect` on mount: `fetch('/api/health')`
- State: `status: 'loading' | 'connected' | 'error'`
- Renders full-viewport dark page (`background: #0f0e0c`)
- Center: app name "PlasticRoom" in IBM Plex Sans, and a status chip:
  - Loading: `rgba(242,237,228,.35)` text — "Connecting…"
  - Connected: `#3ddc97` — "Connected"
  - Error: `#e0654a` — "Connection failed"
- No routing, no components beyond this file

---

## Success Criteria

- `docker-compose up --build` completes without errors
- `http://localhost:3000` loads and shows "Connected" in green
- `/data/plasticroom.db` exists inside the backend container
- Stopping and restarting containers preserves the DB file (volume persistence)

---

## Not In Scope

- Any XPO entity classes (Phase 2)
- Any routing or navigation (Phase 3+)
- Any real UI (Phase 3+)
- Authentication
