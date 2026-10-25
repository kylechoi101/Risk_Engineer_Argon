"""FastAPI app: the SSE analysis stream, fast re-runs, and saved-run lookup. See docs/api.md."""

import json
import os
from collections.abc import AsyncIterator, Mapping
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from argon.agent.agents import RecordedAgent, make_agent
from argon.data.provider import live_provider, make_provider
from argon.pipeline import Deps, Event, run_analysis, simulate_saved_run
from argon.schemas import RunRequest, SimulateRequest
from argon.store import RunStore

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _plain(value):
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


async def sse(events: AsyncIterator[Event]) -> AsyncIterator[str]:
    count = 0
    async for name, data in events:
        count += 1
        payload = json.dumps(data, separators=(",", ":"), default=_plain)
        yield f"id: {count}\nevent: {name}\ndata: {payload}\n\n"


def deps_from_env(env: Mapping[str, str]) -> Deps:
    return Deps(
        agent=make_agent(env),
        store=RunStore(env.get("ARGON_DB", str(BACKEND_DIR / "argon.db"))),
        layers=make_provider(env),
        fallback=RecordedAgent(),
    )


def create_app(deps: Deps | None = None, cors_origins: list[str] | None = None) -> FastAPI:
    if deps is None:
        load_dotenv(BACKEND_DIR / ".env")
        deps = deps_from_env(os.environ)
    if cors_origins is None:
        cors_origins = os.environ.get("ARGON_CORS_ORIGINS", "http://localhost:3000").split(",")

    app = FastAPI(title="Argon-Risk API", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_methods=["*"],
                       allow_headers=["*"])

    @app.post("/api/runs")
    async def start_run(request: RunRequest) -> StreamingResponse:
        return StreamingResponse(
            sse(run_analysis(request, deps)),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/simulate")
    def simulate(request: SimulateRequest) -> dict:
        result = simulate_saved_run(deps, request.run_id, request.selected_fix_ids,
                                    request.budget_m)
        if result is None:
            raise HTTPException(404, f"Unknown run_id {request.run_id!r}. Start a run first.")
        return result

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str) -> dict:
        record = deps.store.get(run_id)
        if record is None:
            raise HTTPException(404, f"Unknown run_id {run_id!r}.")
        return {"run_id": run_id, "scenario": record["scenario"], "fixes": record["fixes"],
                "bundle": record["bundle"]}

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "agent": deps.agent.mode,
                "data": "live" if deps.layers is live_provider else "snapshot"}

    return app

