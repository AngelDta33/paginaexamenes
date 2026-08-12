#!/usr/bin/env python3
"""Static file server for local testing.

Avoids Python's http.server CLI (`python3 -m http.server`) because its argparse
setup calls os.getcwd() eagerly to compute a default, even when --directory is
passed explicitly. In sandboxed process environments where the spawn cwd isn't
readable, that call raises PermissionError before the flag is ever consulted.
Passing the directory straight to the handler class sidesteps that entirely.
"""
import functools
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "."

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
