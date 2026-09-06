"""ASGI entrypoint for the hosted server (Vercel loads `app` from this file).

One deployment serves any public LeetLens data repo: a client connects to
https://<host>/<owner>/<repo>/mcp and every tool reads that repo's generated
data/index.json. Private repos are out of scope here; use local mode.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from starlette.applications import Starlette  # noqa: E402
from starlette.responses import PlainTextResponse  # noqa: E402
from starlette.routing import Mount, Route  # noqa: E402

from leetlens_mcp.server import mcp  # noqa: E402

USAGE = """LeetLens MCP server

Connect to https://<this host>/<github owner>/<data repo>/mcp

  claude mcp add --transport http leetlens https://<this host>/<owner>/<repo>/mcp

or add that URL as a custom connector in ChatGPT or Claude.ai. The data repo
must be public and set up with the LeetLens extension (it needs data/index.json).
https://github.com/g7xu/leetlens
"""


async def usage(_request):
    return PlainTextResponse(USAGE)


inner = mcp.http_app(path="/mcp", stateless_http=True, json_response=True)
app = Starlette(
    routes=[Route("/", usage), Mount("/{owner}/{repo}", app=inner)],
    lifespan=inner.lifespan,
)
