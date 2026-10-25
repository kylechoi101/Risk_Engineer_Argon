# Argon-Risk — agent guide

Hackathon project: an interactive 3D digital twin of the San Francisco waterfront for
stress-testing compound natural and industrial ("natech") disasters. A Monte Carlo cascade
model computes VaR 0.99 and CVaR 0.99. The engineer toggles proactive fixes and re-runs the
model to watch the cascade get blocked and the loss curve shrink.

We have not started building features yet. This file sets the ground rules.

## Deliverables drive scope

- **1-minute video** and **3-minute live demo**. Before building something, ask: does it show up
  in the demo? If not, skip it.
- Keep the demo path working at every commit. Do not leave `main` broken.
- Any external or AI call the demo depends on must have a cached or recorded fallback so the
  demo still runs offline.

## Layout

```
backend/   Python API, simulation engine, SQLite storage
frontend/  Next.js (App Router, TypeScript) + Tailwind + three.js
```

The backend and frontend are separate apps with separate dependencies and test suites. Run
commands from inside the right folder. They talk only over HTTP/JSON. Write the API contract
down before building either side of it.

## Stack

- **Backend:** Python 3.12+, `uv` for environments and dependencies, `pytest` for tests, SQLite
  through the standard-library `sqlite3` module. Use FastAPI unless the team decides otherwise.
- **Frontend:** Next.js + TypeScript + Tailwind CSS. For three.js, prefer `@react-three/fiber`
  and `@react-three/drei` over a hand-rolled renderer. Use Vitest and React Testing Library
  for unit tests.

## TDD workflow (required)

1. **Red:** write one failing test that states the behavior you want. Run it and watch it fail
   for the right reason.
2. **Green:** write the smallest change that makes the test pass.
3. **Refactor:** clean up while the tests stay green.
4. Commit after each green step. Keep commits small and focused.

Rules:
- Every bug fix starts with a test that reproduces the bug.
- Make the simulation deterministic under a seed so tests can assert exact numbers.
- Keep simulation math (cascade, VaR/CVaR, fix ranking, budget selection) in pure functions so
  it can be tested without the API or the database.
- Use a temporary or in-memory SQLite database in tests, never the dev database.
- Hide external AI and model calls behind an interface. Tests use a fake.
- Treat the "re-run in under 2 seconds" goal as a test: add a timing test for the simulation
  once it exists.
- Frontend: test state, data transforms, and controls (fix toggles, budget ceiling). Do not
  unit-test WebGL output. Check the 3D scene by running the app.

## Commands

Fill these in when each app is scaffolded, and keep them accurate.

| Task | backend/ | frontend/ |
|------|----------|-----------|
| Install | `uv sync` | `npm install` |
| Test | `uv run pytest` | `npm test` |
| Dev server | `uv run fastapi dev` | `npm run dev` |
| Lint | `uv run ruff check .` | `npm run lint` |

## Before you say you are done

- Run the test suite for each app you touched, and make sure it passes.
- Report your work as **Changed / Verified / Assumptions / Left undone**.
- Do not commit secrets. API keys go in `.env` files, which are gitignored. Commit a
  `.env.example` instead.
