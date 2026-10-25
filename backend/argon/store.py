"""SQLite storage for saved runs, so fix toggles can re-run a run by id."""

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
)
"""


class RunStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with self._connect() as db:
            db.execute(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def save(self, run_id: str, record: dict) -> None:
        with self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO runs (run_id, created_at, payload) VALUES (?, ?, ?)",
                (run_id, datetime.now(UTC).isoformat(), json.dumps(record)),
            )

    def get(self, run_id: str) -> dict | None:
        with self._connect() as db:
            row = db.execute("SELECT payload FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        return json.loads(row[0]) if row else None
