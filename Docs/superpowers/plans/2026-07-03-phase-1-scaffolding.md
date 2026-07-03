# Phase 1 Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, containerized skeleton for PlasticRoom — frontend and backend containers running via `docker-compose`, talking to each other, with a verified SQLite connection through DevExpress XPO. Nothing visual beyond a status page.

**Architecture:** Two Docker services wired by `docker-compose.yml`. `frontend` is a Vite + React + TypeScript app built to static files and served by Nginx, which proxies `/api/*` to the backend container. `backend` is an ASP.NET Core 8 Web API that opens a DevExpress XPO session against a SQLite file stored on a named Docker volume (`plasticroom-data`), mounted at `/data`, so the database survives container rebuilds.

**Tech Stack:** React 18 + TypeScript + Vite (frontend build), Nginx alpine (frontend serve), ASP.NET Core 8 Web API (backend), DevExpress.Xpo + System.Data.SQLite.Core (ORM + SQLite driver), Docker + docker-compose, Vitest + React Testing Library (frontend tests), xUnit (backend tests).

## Global Constraints

- Frontend dev proxy: `/api` → `http://localhost:5000` (vite.config.ts, local dev only).
- Frontend prod proxy: Nginx proxies `/api/` → `http://backend:5000/api/` — the browser never calls the backend directly in the container setup.
- Backend internal port: `5000`. Frontend host port: `3000`.
- `DATA_PATH` env var on backend, default `/data`; SQLite file at `{DATA_PATH}/plasticroom.db`.
- Named Docker volume `plasticroom-data` mounted at `/data` in the backend container, for persistence across rebuilds.
- `frontend` service depends on `backend` in docker-compose.
- CORS on backend: allow any origin (development-friendly; explicitly temporary, revisit in a later phase).
- `GET /api/health` returns `200 { "status": "ok", "db": "connected" }` on success, `503 { "status": "error", "db": "failed", "detail": "<message>" }` on failure.
- No XPO entity classes in this phase — only a session factory that proves the connection opens.
- No routing, no component library, no auth — out of scope per spec.
- Colors/fonts for the App.tsx status page (from spec, use verbatim):
  - Background: `#0f0e0c`
  - Font: IBM Plex Sans (loaded from Google Fonts in `index.html`)
  - Loading state color: `rgba(242,237,228,.35)`, label "Connecting…"
  - Connected state color: `#3ddc97`, label "Connected"
  - Error state color: `#e0654a`, label "Connection failed"
  - App title text: "PlasticRoom"

---

## File Structure

```
PlasticRoom/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── App.test.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── vitest.setup.ts
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
├── backend/
│   ├── PlasticRoom.Api/
│   │   ├── Controllers/
│   │   │   └── HealthController.cs
│   │   ├── Data/
│   │   │   └── XpoSessionFactory.cs
│   │   ├── PlasticRoom.Api.csproj
│   │   ├── Program.cs
│   │   └── Dockerfile
│   ├── PlasticRoom.Api.Tests/
│   │   ├── PlasticRoom.Api.Tests.csproj
│   │   ├── XpoSessionFactoryTests.cs
│   │   └── HealthControllerTests.cs
│   └── PlasticRoom.sln
├── docker-compose.yml
└── .gitignore
```

---

### Task 1: Frontend scaffold — Vite + React + TS with health-check smoke test

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`
- Create: `.gitignore` (repo root)

**Interfaces:**
- Produces: `App` default-exported React component from `frontend/src/App.tsx`, rendering a status chip driven by `fetch('/api/health')`.
- Produces: `frontend/vite.config.ts` dev proxy `/api` → `http://localhost:5000`, used by Task 3's Nginx config as the equivalent prod-time mapping.
- Consumes: nothing from other tasks (first task).

- [ ] **Step 1: Verify Node tooling is available**

Run: `node --version && npm --version`
Expected: Node 20.x or later, npm 10.x or later. If Node is missing or older, stop and report BLOCKED — do not attempt to install Node yourself.

- [ ] **Step 2: Create `frontend/package.json`**

```json
{
  "name": "plasticroom-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `frontend/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
  },
})
```

- [ ] **Step 6: Create `frontend/vitest.setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 7: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PlasticRoom</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `frontend/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 9: Write the failing test for `App`**

Create `frontend/src/App.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a connecting state before the health check resolves', () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {}),
    )

    render(<App />)

    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })

  it('shows Connected when /api/health responds ok', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', db: 'connected' }),
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/health')
  })

  it('shows Connection failed when /api/health rejects', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error'),
    )

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Connection failed')).toBeInTheDocument(),
    )
  })

  it('shows Connection failed when /api/health responds with a non-ok status', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ status: 'error', db: 'failed' }),
    })

    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Connection failed')).toBeInTheDocument(),
    )
  })
})
```

- [ ] **Step 10: Install dependencies**

Run: `cd frontend && npm install`
Expected: installs without errors (no `App.tsx` exists yet, so tests will fail to import it).

- [ ] **Step 11: Run the test to verify it fails**

Run: `cd frontend && npx vitest run`
Expected: FAIL — `Failed to resolve import "./App"` or similar module-not-found error.

- [ ] **Step 12: Implement `frontend/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'

type Status = 'loading' | 'connected' | 'error'

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  loading: { label: 'Connecting…', color: 'rgba(242,237,228,.35)' },
  connected: { label: 'Connected', color: '#3ddc97' },
  error: { label: 'Connection failed', color: '#e0654a' },
}

export default function App() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let cancelled = false

    fetch('/api/health')
      .then((res) => {
        if (cancelled) return
        setStatus(res.ok ? 'connected' : 'error')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const { label, color } = STATUS_CONFIG[status]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: '#0f0e0c',
        fontFamily: "'IBM Plex Sans', sans-serif",
        color: '#f2ede4',
      }}
    >
      <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 16 }}>
        PlasticRoom
      </h1>
      <span style={{ fontSize: 13, color }}>{label}</span>
    </div>
  )
}
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `cd frontend && npx vitest run`
Expected: PASS — 4 tests passing.

- [ ] **Step 14: Verify the production build compiles**

Run: `cd frontend && npm run build`
Expected: completes without TypeScript or Vite errors, produces `frontend/dist/`.

- [ ] **Step 15: Create root `.gitignore`**

```
node_modules/
dist/
bin/
obj/
*.db
.vs/
```

- [ ] **Step 16: Commit**

```bash
git add frontend .gitignore
git commit -m "feat: scaffold Vite/React/TS frontend with health-check smoke test"
```

---

### Task 2: Backend scaffold — ASP.NET Core 8 API with XPO SQLite session factory and health endpoint

**Files:**
- Create: `backend/PlasticRoom.sln`
- Create: `backend/PlasticRoom.Api/PlasticRoom.Api.csproj`
- Create: `backend/PlasticRoom.Api/Program.cs`
- Create: `backend/PlasticRoom.Api/Data/XpoSessionFactory.cs`
- Create: `backend/PlasticRoom.Api/Controllers/HealthController.cs`
- Create: `backend/PlasticRoom.Api.Tests/PlasticRoom.Api.Tests.csproj`
- Create: `backend/PlasticRoom.Api.Tests/XpoSessionFactoryTests.cs`
- Create: `backend/PlasticRoom.Api.Tests/HealthControllerTests.cs`

**Interfaces:**
- Produces: `XpoSessionFactory` class (`namespace PlasticRoom.Api.Data`) with constructor `XpoSessionFactory(string? dataPath = null)` (reads `DATA_PATH` env var when `dataPath` is null, defaults to `/data`), and method `Session CreateSession()` returning a `DevExpress.Xpo.Session`. Also exposes `string DatabasePath { get; }` (the resolved `.db` file path) for tests/health checks.
- Produces: `GET /api/health` — `200 { "status": "ok", "db": "connected" }` on success, `503 { "status": "error", "db": "failed", "detail": "<message>" }` on exception.
- Consumes: nothing from Task 1 (backend and frontend are independent builds); Task 3 consumes `XpoSessionFactory`'s `DATA_PATH` env var contract and the `/api/health` route.

- [ ] **Step 1: Verify .NET SDK is available**

Run: `dotnet --version`
Expected: `8.0.x` or later. If missing, stop and report BLOCKED.

- [ ] **Step 2: Create the solution and projects**

```bash
mkdir -p backend/PlasticRoom.Api backend/PlasticRoom.Api.Tests
cd backend
dotnet new sln -n PlasticRoom
dotnet new webapi --use-controllers -o PlasticRoom.Api -n PlasticRoom.Api
dotnet new xunit -o PlasticRoom.Api.Tests -n PlasticRoom.Api.Tests
dotnet sln add PlasticRoom.Api/PlasticRoom.Api.csproj
dotnet sln add PlasticRoom.Api.Tests/PlasticRoom.Api.Tests.csproj
cd PlasticRoom.Api.Tests
dotnet add reference ../PlasticRoom.Api/PlasticRoom.Api.csproj
cd ..
```

Expected: solution builds (`dotnet build`) with the default WeatherForecast template present — this will be removed in a later step.

- [ ] **Step 3: Remove template scaffolding**

Delete `backend/PlasticRoom.Api/WeatherForecast.cs` and `backend/PlasticRoom.Api/Controllers/WeatherForecastController.cs` if generated, and delete the default `UnitTest1.cs` in `backend/PlasticRoom.Api.Tests/` if generated.

- [ ] **Step 4: Add NuGet packages**

```bash
cd backend/PlasticRoom.Api
dotnet add package DevExpress.Xpo --version 24.1.6
dotnet add package System.Data.SQLite.Core --version 1.0.118
cd ../PlasticRoom.Api.Tests
dotnet add package DevExpress.Xpo --version 24.1.6
dotnet add package System.Data.SQLite.Core --version 1.0.118
cd ../..
```

Expected: both projects restore successfully from nuget.org (no DevExpress-specific feed required — `DevExpress.Xpo` is published on the public nuget.org feed).

- [ ] **Step 5: Write the failing test for `XpoSessionFactory`**

Create `backend/PlasticRoom.Api.Tests/XpoSessionFactoryTests.cs`:

```csharp
using System;
using System.IO;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using Xunit;

namespace PlasticRoom.Api.Tests;

public class XpoSessionFactoryTests : IDisposable
{
    private readonly string _tempDir;

    public XpoSessionFactoryTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-xpo-tests-" + Guid.NewGuid());
    }

    [Fact]
    public void CreatesDataDirectoryIfMissing()
    {
        Assert.False(Directory.Exists(_tempDir));

        var factory = new XpoSessionFactory(_tempDir);

        Assert.True(Directory.Exists(_tempDir));
    }

    [Fact]
    public void DatabasePathPointsAtPlasticRoomDbInsideDataPath()
    {
        var factory = new XpoSessionFactory(_tempDir);

        Assert.Equal(Path.Combine(_tempDir, "plasticroom.db"), factory.DatabasePath);
    }

    [Fact]
    public void CreateSessionOpensWithoutError()
    {
        var factory = new XpoSessionFactory(_tempDir);

        using var session = factory.CreateSession();

        Assert.NotNull(session);
        Assert.True(File.Exists(factory.DatabasePath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter XpoSessionFactoryTests`
Expected: FAIL to build — `XpoSessionFactory` does not exist.

- [ ] **Step 7: Implement `backend/PlasticRoom.Api/Data/XpoSessionFactory.cs`**

```csharp
using System;
using System.IO;
using DevExpress.Xpo;
using DevExpress.Xpo.DB;

namespace PlasticRoom.Api.Data;

public class XpoSessionFactory
{
    private readonly IDataLayer _dataLayer;

    public string DatabasePath { get; }

    public XpoSessionFactory(string? dataPath = null)
    {
        var resolvedDataPath = dataPath
            ?? Environment.GetEnvironmentVariable("DATA_PATH")
            ?? "/data";

        Directory.CreateDirectory(resolvedDataPath);

        DatabasePath = Path.Combine(resolvedDataPath, "plasticroom.db");

        var connectionString = SQLiteConnectionProvider.GetConnectionString(DatabasePath);
        _dataLayer = XpoDefault.GetDataLayer(connectionString, AutoCreateOption.DatabaseAndSchema);
    }

    public Session CreateSession() => new(_dataLayer);
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter XpoSessionFactoryTests`
Expected: PASS — 3 tests passing.

- [ ] **Step 9: Write the failing test for `HealthController`**

Create `backend/PlasticRoom.Api.Tests/HealthControllerTests.cs`:

```csharp
using System;
using System.IO;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using Xunit;

namespace PlasticRoom.Api.Tests;

public class HealthControllerTests : IDisposable
{
    private readonly string _tempDir;

    public HealthControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-health-tests-" + Guid.NewGuid());
    }

    [Fact]
    public void Get_ReturnsOkWithConnectedStatus_WhenDatabaseIsReachable()
    {
        var factory = new XpoSessionFactory(_tempDir);
        var controller = new HealthController(factory);

        var result = Assert.IsType<OkObjectResult>(controller.Get());

        Assert.Equal(200, result.StatusCode);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter HealthControllerTests`
Expected: FAIL to build — `HealthController` does not exist.

- [ ] **Step 11: Implement `backend/PlasticRoom.Api/Controllers/HealthController.cs`**

```csharp
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    private readonly XpoSessionFactory _sessionFactory;

    public HealthController(XpoSessionFactory sessionFactory)
    {
        _sessionFactory = sessionFactory;
    }

    [HttpGet]
    public IActionResult Get()
    {
        try
        {
            using var session = _sessionFactory.CreateSession();
            return Ok(new { status = "ok", db = "connected" });
        }
        catch (System.Exception ex)
        {
            return StatusCode(503, new { status = "error", db = "failed", detail = ex.Message });
        }
    }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter HealthControllerTests`
Expected: PASS — 1 test passing.

- [ ] **Step 13: Wire up `backend/PlasticRoom.Api/Program.cs`**

```csharp
using PlasticRoom.Api.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<XpoSessionFactory>();
builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseCors();
app.MapControllers();

app.Run();
```

- [ ] **Step 14: Run the full backend test suite**

Run: `cd backend && dotnet test`
Expected: PASS — all tests (XpoSessionFactory + HealthController) passing, 0 failures.

- [ ] **Step 15: Manually verify the endpoint locally**

Run: `cd backend/PlasticRoom.Api && DATA_PATH=/tmp/plasticroom-manual-check dotnet run --urls http://localhost:5000 &`
then: `curl -s http://localhost:5000/api/health`
Expected: `{"status":"ok","db":"connected"}`. Stop the server afterward (`kill %1` or equivalent) and remove `/tmp/plasticroom-manual-check`.

- [ ] **Step 16: Commit**

```bash
git add backend
git commit -m "feat: scaffold ASP.NET Core 8 API with XPO SQLite session factory and health endpoint"
```

---

### Task 3: Docker wiring — Dockerfiles, docker-compose, Nginx proxy

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`
- Create: `backend/PlasticRoom.Api/Dockerfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: `frontend/dist` build output (Task 1), `backend/PlasticRoom.Api` project + `/api/health` route + `DATA_PATH` contract (Task 2).
- Produces: `docker-compose.yml` services `frontend` (host port 3000) and `backend` (internal port 5000, volume `plasticroom-data` at `/data`) — consumed by Task 4's end-to-end verification.

- [ ] **Step 1: Create `frontend/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:5000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Create `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 3: Create `backend/PlasticRoom.Api/Dockerfile`**

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY PlasticRoom.Api.csproj .
RUN dotnet restore PlasticRoom.Api.csproj
COPY . .
RUN dotnet publish PlasticRoom.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
ENV DATA_PATH=/data
ENV ASPNETCORE_URLS=http://+:5000
EXPOSE 5000
ENTRYPOINT ["dotnet", "PlasticRoom.Api.dll"]
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  backend:
    build:
      context: ./backend/PlasticRoom.Api
    volumes:
      - plasticroom-data:/data
    environment:
      - DATA_PATH=/data

  frontend:
    build:
      context: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  plasticroom-data:
```

- [ ] **Step 5: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf backend/PlasticRoom.Api/Dockerfile docker-compose.yml
git commit -m "feat: add Dockerfiles and docker-compose wiring for frontend/backend"
```

---

### Task 4: End-to-end verification

**Files:** none created — this task only runs and verifies the containerized system built in Tasks 1–3.

**Interfaces:**
- Consumes: `docker-compose.yml`, both Dockerfiles, `/api/health`, `plasticroom-data` volume (all from Task 3).

- [ ] **Step 1: Build and start the stack**

Run: `docker-compose up --build -d`
Expected: both `backend` and `frontend` images build and containers start without errors. Run `docker-compose ps` to confirm both are `Up`.

- [ ] **Step 2: Verify the frontend loads and reports Connected**

Run: `curl -s http://localhost:3000/ | grep -o 'PlasticRoom'`
Expected: `PlasticRoom` (confirms the built `index.html` is served).

Run: `curl -s http://localhost:3000/api/health`
Expected: `{"status":"ok","db":"connected"}` (confirms the Nginx proxy reaches the backend).

- [ ] **Step 3: Verify the SQLite file exists inside the backend container**

Run: `docker-compose exec backend ls /data`
Expected: `plasticroom.db` listed.

- [ ] **Step 4: Verify volume persistence across restarts**

Run: `docker-compose restart backend`
then: `docker-compose exec backend ls /data`
Expected: `plasticroom.db` still present (same file, not recreated empty) — confirm by checking the file is non-zero size: `docker-compose exec backend stat -c%s /data/plasticroom.db` should be greater than 0.

- [ ] **Step 5: Tear down**

Run: `docker-compose down`
Expected: containers stop and are removed; the named volume `plasticroom-data` persists (not removed, since `-v` was not passed).

- [ ] **Step 6: Commit (only if any fixes were needed during verification)**

If Steps 1–5 all passed with no code changes, no commit is needed for this task — report DONE with a summary of the verification output. If a fix was required, commit it:

```bash
git add -A
git commit -m "fix: correct docker wiring issue found during end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** All 8 deliverables and both success criteria items from `Docs/superpowers/specs/2026-07-02-phase-1-scaffolding.md` map to a task: frontend scaffold + Dockerfile (Task 1, Task 3), backend scaffold + Dockerfile (Task 2, Task 3), docker-compose (Task 3), XPO session factory (Task 2), `/api/health` (Task 2), App.tsx smoke test (Task 1), all four Success Criteria (Task 4).
- **Not In Scope items respected:** no XPO entity classes, no routing, no real UI, no auth appear anywhere in the plan.
- **Type/name consistency checked:** `XpoSessionFactory.CreateSession()` and `DatabasePath` (Task 2) are used identically in `HealthController` (Task 2) — no later task references them under a different name.
