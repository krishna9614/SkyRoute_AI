"""SkyRoute AI app server.

Serves the custom SkyRoute chat UI plus the ADK agent API
(``/apps/...``, ``/run_sse``) from a single FastAPI process, replacing the
default ``adk web`` UI.

Run:
    python app.py          # serves UI + API on http://localhost:8000
"""

import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from google.adk.cli.fast_api import get_fast_api_app

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
UI_PORT = int(os.getenv("UI_PORT", "8000"))
UI_HOST = os.getenv("UI_HOST", "0.0.0.0")

# web=False disables the default ADK dev UI; the API routes stay.
app = get_fast_api_app(
    agents_dir=str(BASE_DIR),
    web=False,
    allow_origins=["*"],
)

# Mounted last so API routes take precedence; "/" serves the chat UI.
app.mount(
    "/",
    StaticFiles(directory=BASE_DIR / "web", html=True),
    name="skyroute-ui",
)


if __name__ == "__main__":
    uvicorn.run(app, host=UI_HOST, port=UI_PORT)
