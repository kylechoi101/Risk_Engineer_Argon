"""ASGI entrypoint: `uv run fastapi dev` serves this app, configured from env and .env."""

from argon.api import create_app

app = create_app()
