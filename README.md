# FortiManager Profile Comparator

A single-pane comparison tool for FortiManager security profiles and SD-WAN templates. Instantly spot configuration drift between cloned profiles and pin fields that must stay consistent.

![Stack](https://img.shields.io/badge/Next.js-15-black?logo=next.js) ![Stack](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi) ![Stack](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss)

## Problem

When a "golden" FortiManager profile is cloned, the clone's configuration is completely decoupled from the original. Over time, drift accumulates silently — fields that should stay consistent diverge without any visibility. With dozens of profiles across Application Control, Web Filter, IPS Sensors, and SD-WAN Templates, manually auditing every field is impractical.

## Solution

This tool reads profiles directly from the FortiManager API, flattens their nested configuration into a field-level comparison matrix, and presents a single-pane view where:

- **In-sync** fields are clearly marked (✓)
- **Differing** fields are highlighted (≠)
- **Pinned** fields that *must* stay consistent trigger **DRIFT** alerts (⚠) when they diverge
- Filters let you focus on what matters: all fields, only differences, only in-sync, or only pinned

### Supported Profile Types

| Type | FMG Path |
|------|----------|
| Application Control | `Security Profiles > Application Control` |
| Web Filter | `Security Profiles > Web Filter` |
| IPS Sensor | `Security Profiles > IPS Sensor` |
| SD-WAN Template | `SD-WAN > Templates` |

## Architecture

```
┌─────────────────────────────────┐
│  Next.js Frontend (port 3000)   │
│  - Profile type/name selector   │
│  - Side-by-side comparison      │
│  - Pin toggles per field        │
│  - Filter/search                │
└──────────────┬──────────────────┘
               │ REST API
┌──────────────▼──────────────────┐
│  FastAPI Backend (port 8000)    │
│  - FMG JSON-RPC client          │
│  - Profile flattener/comparator │
│  - Pin state persistence        │
└──────────────┬──────────────────┘
               │ JSON-RPC
┌──────────────▼──────────────────┐
│  FortiManager                   │
└─────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- A FortiManager instance with API access

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure your FMG connection
cp .env.example .env
# Edit .env with your FortiManager details

uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. **Select a profile type** (Application Control, Web Filter, IPS, or SD-WAN)
2. **Check two or more profiles** to compare
3. **Click "Compare"** — the table shows every configuration field side-by-side
4. **Pin fields** (📌) that must stay consistent across profiles
5. **Filter** by sync status or search for specific fields
6. Pinned fields that have diverged show a red **⚠ DRIFT** alert

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/profiles/types` | List available profile types |
| `GET` | `/api/profiles/{type}` | List profile names for a type |
| `GET` | `/api/profiles/{type}/{name}` | Get full profile config |
| `GET` | `/api/profiles/{type}/compare?name=A&name=B` | Compare multiple profiles |
| `GET` | `/api/profiles/{type}/pins` | Get pinned fields |
| `POST` | `/api/profiles/{type}/pins` | Toggle a field pin |

## Development

```bash
# Run both services
cd backend && uvicorn app.main:app --reload --port 8000 &
cd frontend && npm run dev &
```

## License

MIT
