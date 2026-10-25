"""Agents behind one interface: live Gemini, recorded replay, and the offline fallback.

The pipeline only sees `parse_prompt`, `propose_fixes` and `narrate`. Proposals come back as
raw dicts and are validated by argon.agent.validate; `None` means "use the built-in catalog".
"""

import asyncio
import json
import os
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Protocol

from argon.agent.parse import parse_prompt
from argon.agent.prompts import (
    HAZARD_JSON_SCHEMA,
    contract_plan_prompt,
    fixes_prompt,
    narrative_prompt,
    parse_prompt_text,
    template_narrative,
)
from argon.agent.validate import FIX_JSON_SCHEMA
from argon.contract.plan import PLAN_JSON_SCHEMA

RECORDINGS_DIR = Path(__file__).resolve().parents[2] / "recordings"
DEFAULT_MODEL = "gemini-4-argon"


class Agent(Protocol):
    mode: str

    async def parse_prompt(self, prompt: str) -> list[dict]: ...

    async def propose_fixes(self, context: dict, max_fixes: int) -> list | None: ...

    def narrate(self, context: dict) -> AsyncIterator[str]: ...

    async def plan_contract(self, context: dict) -> dict | None: ...


def recording_key(context: dict) -> str:
    scenario = context["scenario"]
    return f"m{scenario['magnitude']:.1f}_tide{scenario['water_level']['ft_mllw']:.1f}ft"


def _read_named(directory: Path, key: str) -> dict:
    try:
        return json.loads((Path(directory) / f"{key}.json").read_text())
    except (OSError, ValueError):
        return {}


def _write_named(directory: Path, key: str, **fields) -> None:
    path = Path(directory) / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _read_named(directory, key)
    data.update(fields)
    path.write_text(json.dumps(data, indent=2))


def _read_recording(directory: Path, context: dict) -> dict:
    return _read_named(directory, recording_key(context))


def _write_recording(directory: Path, context: dict, **fields) -> None:
    _write_named(directory, recording_key(context), **fields)


class RecordedAgent:
    """Replays saved Gemini replies; without one, uses the catalog and a template narrative."""

    mode = "recorded"

    def __init__(self, directory: Path = RECORDINGS_DIR, delay_s: float = 0.02):
        self.directory = Path(directory)
        self.delay_s = delay_s

    async def parse_prompt(self, prompt: str) -> list[dict]:
        return parse_prompt(prompt)

    async def propose_fixes(self, context: dict, max_fixes: int) -> list | None:
        return _read_recording(self.directory, context).get("fixes")

    async def plan_contract(self, context: dict) -> dict | None:
        return _read_named(self.directory, context["recording_key"]).get("plan")

    async def narrate(self, context: dict) -> AsyncIterator[str]:
        text = _read_recording(self.directory, context).get("narrative") or template_narrative(
            context
        )
        words = text.split(" ")
        for i, word in enumerate(words):
            yield word if i == len(words) - 1 else word + " "
            if self.delay_s:
                await asyncio.sleep(self.delay_s)


class GeminiAgent:
    """Live gemini-4-argon via google-genai. Optionally records replies for offline replay."""

    mode = "live"

    def __init__(self, client, model: str = DEFAULT_MODEL, record_dir: Path | None = None,
                 timeout_s: float = 60):
        self.client = client
        self.model = model
        self.record_dir = record_dir
        self.timeout_s = timeout_s

    def _json_config(self, schema: dict):
        from google.genai import types

        return types.GenerateContentConfig(
            response_mime_type="application/json", response_json_schema=schema, temperature=0.4
        )

    async def _json(self, contents: str, schema: dict) -> dict:
        response = await asyncio.wait_for(
            self.client.aio.models.generate_content(
                model=self.model, contents=contents, config=self._json_config(schema)
            ),
            self.timeout_s,
        )
        return json.loads(response.text)

    async def parse_prompt(self, prompt: str) -> list[dict]:
        data = await self._json(parse_prompt_text(prompt), HAZARD_JSON_SCHEMA)
        return data.get("hazards", [])

    async def propose_fixes(self, context: dict, max_fixes: int) -> list | None:
        data = await self._json(fixes_prompt(context, max_fixes), FIX_JSON_SCHEMA)
        fixes = data.get("fixes")
        if self.record_dir is not None and fixes:
            _write_recording(self.record_dir, context, fixes=fixes)
        return fixes

    async def plan_contract(self, context: dict) -> dict | None:
        plan = await self._json(contract_plan_prompt(context), PLAN_JSON_SCHEMA)
        if self.record_dir is not None and plan:
            _write_named(self.record_dir, context["recording_key"], plan=plan)
        return plan

    async def narrate(self, context: dict) -> AsyncIterator[str]:
        stream = await asyncio.wait_for(
            self.client.aio.models.generate_content_stream(
                model=self.model, contents=narrative_prompt(context)
            ),
            self.timeout_s,
        )
        parts = []
        async for chunk in stream:
            if chunk.text:
                parts.append(chunk.text)
                yield chunk.text
        if self.record_dir is not None and parts:
            _write_recording(self.record_dir, context, narrative="".join(parts))


def make_agent(env: Mapping[str, str] = os.environ, recordings: Path = RECORDINGS_DIR) -> Agent:
    key = env.get("GEMINI_API_KEY")
    mode = env.get("ARGON_AGENT") or ("live" if key else "recorded")
    if mode == "live" and key:
        from google import genai

        return GeminiAgent(
            genai.Client(api_key=key),
            model=env.get("ARGON_GEMINI_MODEL", DEFAULT_MODEL),
            record_dir=recordings if env.get("ARGON_RECORD") == "1" else None,
        )
    return RecordedAgent(recordings)
