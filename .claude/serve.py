#!/usr/bin/env python3
"""Static file server for local testing.

Avoids Python's http.server CLI (`python3 -m http.server`) because its argparse
setup calls os.getcwd() eagerly to compute a default, even when --directory is
passed explicitly. In sandboxed process environments where the spawn cwd isn't
readable, that call raises PermissionError before the flag is ever consulted.
Passing the directory straight to the handler class sidesteps that entirely.

Also disables all caching (Cache-Control: no-store) — this is a JS-module-heavy
app with no build step, and browsers cache ES module scripts aggressively by URL,
sometimes even across full navigations/new tabs. Without this, edits made mid-session
can silently keep serving stale module graphs.
"""
import functools
import http.server
import os
import socketserver
import sys

# PORT env var (set by the preview runner when it assigns a free port) wins
# over the positional arg, so this still works whether launched by hand
# (`python3 serve.py 8420 <dir>`) or by the runner's autoPort assignment.
PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8420))
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "."


class SinCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


Handler = functools.partial(SinCacheHandler, directory=DIRECTORY)
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
