# SkyRoute AI

AI travel assistant: a single Google ADK root agent powered by Gemini that
calls tools served by two independent MCP servers.

Phase 1 — scaffolding and connectivity only: one root agent, no sub-agents,
mock MCP tools, no external APIs or databases.

## Architecture

```
user ──> SkyRoute UI (app.py, FastAPI) ──> skyroute_agent (LlmAgent, Gemini)
                                              │
                                              ├── McpToolset ──> skyroute-weather-mcp ──> get_weather(city)
                                              └── McpToolset ──> skyroute-places-mcp  ──> search_places(city)
```

| Repo                                                            | Role                                              | Default endpoint                 |
| --------------------------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| [SkyRoute_AI](https://github.com/krishna9614/SkyRoute_AI)       | ADK root agent + custom chat UI (this repo)       | `python app.py` on `:8000`       |
| [skyroute-weather-mcp](https://github.com/krishna9614/skyroute-weather-mcp) | Weather MCP server — `get_weather(city)`          | `http://127.0.0.1:8001/weather-mcp` |
| [skyroute-places-mcp](https://github.com/krishna9614/skyroute-places-mcp)   | Places MCP server — `search_places(city)`         | `http://127.0.0.1:8002/places-mcp`  |

## Requirements

- Python 3.10+
- A Gemini API key ([Google AI Studio](https://aistudio.google.com/apikey))

## Setup

```bash
# 1. Weather MCP server (terminal 1)
git clone https://github.com/krishna9614/skyroute-weather-mcp
cd skyroute-weather-mcp
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python server.py

# 2. Places MCP server (terminal 2)
git clone https://github.com/krishna9614/skyroute-places-mcp
cd skyroute-places-mcp
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python server.py

# 3. ADK root agent + SkyRoute UI (terminal 3)
git clone https://github.com/krishna9614/SkyRoute_AI
cd SkyRoute_AI
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set GOOGLE_API_KEY
python app.py
```

Open `http://localhost:8000` — the custom SkyRoute chat UI is served by the
same FastAPI process that exposes the agent API (`/apps/...`, `/run_sse`).
The default ADK dev UI is still available via `adk web` if needed.

## Configuration

All values live in `.env` (see `.env.example`):

| Variable                   | Default                     | Purpose                          |
| -------------------------- | --------------------------- | -------------------------------- |
| `GOOGLE_API_KEY`           | _(empty — required)_        | Gemini API key                   |
| `GOOGLE_GENAI_USE_VERTEXAI`| `FALSE`                     | Use AI Studio key, not Vertex    |
| `SKYROUTE_MODEL`           | `gemini-2.5-flash`          | Gemini model for the root agent  |
| `WEATHER_MCP_URL`          | `http://127.0.0.1:8001/weather-mcp` | Weather MCP streamable-HTTP URL  |
| `PLACES_MCP_URL`           | `http://127.0.0.1:8002/places-mcp`  | Places MCP streamable-HTTP URL   |

## Validation

| Query                                    | Expected behavior              |
| ---------------------------------------- | ------------------------------ |
| "What's the weather in Paris?"           | `get_weather` called           |
| "What can I visit in Tokyo?"             | `search_places` called         |
| "Weather and things to do in London?"    | Both tools called              |
| "Hi, how are you?"                       | No tool called                 |

Tool calls are logged at `INFO` level in the `python app.py` terminal
(`tool call / tool result / tool error` lines from `skyroute.agent`), and on
the MCP server side each invocation logs its name, arguments, and result.
In the UI, tool calls also appear as activity chips inside the agent's reply
bubble.
