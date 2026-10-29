"""SkyRoute root agent.

A single Google ADK ``LlmAgent`` backed by Gemini that connects to the
SkyRoute MCP servers (weather + places) over streamable HTTP.

Phase 1: scaffolding and connectivity only — one root agent, no sub-agents.
"""

import logging
import os
from typing import Any, Optional

from dotenv import load_dotenv

from google.adk.agents import LlmAgent
from google.adk.agents.context import Context
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams

load_dotenv()

logger = logging.getLogger("skyroute.agent")

MODEL = os.getenv("SKYROUTE_MODEL", "gemini-2.5-flash")
WEATHER_MCP_URL = os.getenv("WEATHER_MCP_URL", "http://127.0.0.1:8001/mcp")
PLACES_MCP_URL = os.getenv("PLACES_MCP_URL", "http://127.0.0.1:8002/mcp")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def log_tool_call(
    tool: BaseTool, args: dict[str, Any], context: Context
) -> Optional[dict[str, Any]]:
    logger.info("tool call: name=%s args=%s", tool.name, args)
    return None


def log_tool_result(
    tool: BaseTool,
    args: dict[str, Any],
    context: Context,
    tool_response: dict[str, Any],
) -> Optional[dict[str, Any]]:
    logger.info("tool result: name=%s result=%s", tool.name, tool_response)
    return None


def log_tool_error(
    tool: BaseTool, args: dict[str, Any], context: Context, error: Exception
) -> Optional[dict[str, Any]]:
    logger.error("tool error: name=%s error=%s", tool.name, error)
    return None


weather_toolset = McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=WEATHER_MCP_URL),
)

places_toolset = McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=PLACES_MCP_URL),
)

root_agent = LlmAgent(
    name="skyroute_agent",
    model=MODEL,
    instruction=(
        "You are SkyRoute, an AI travel assistant.\n"
        "- Use the `get_weather` tool to answer questions about weather in a city.\n"
        "- Use the `search_places` tool to answer questions about places, "
        "attractions, or things to do in a city.\n"
        "- If a question needs both, call both tools.\n"
        "- For greetings or questions unrelated to travel weather or places, "
        "answer directly without calling tools.\n"
        "Keep answers concise and friendly."
    ),
    tools=[weather_toolset, places_toolset],
    before_tool_callback=log_tool_call,
    after_tool_callback=log_tool_result,
    on_tool_error_callback=log_tool_error,
)
