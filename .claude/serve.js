// Static file server for local testing.
//
// Node equivalent of serve.py — needed because the sandboxed process that
// launches preview servers has never been granted Documents-folder access
// for python3 specifically (macOS ties that permission to the exact binary,
// and node already had it from other tooling), so python3 fails with EPERM
// before it can even open the script.
//
// Also disables all caching (Cache-Control: no-store) — this is a JS-module-heavy
// app with no build step, and browsers cache ES module scripts aggressively by URL,
// sometimes even across full navigations/new tabs. Without this, edits made mid-session
// can silently keep serving stale module graphs.

const http = require('http');
const fs = require('fs');
const path = require('path');

// PORT env var (set by the preview runner when it assigns a free port) wins
// over the positional arg, so this still works whether launched by hand
// (`node serve.js 8420 <dir>`) or by the runner's autoPort assignment.
const PORT = parseInt(process.env.PORT || process.argv[2] || '8420', 10);
const DIRECTORY = path.resolve(process.argv[3] || '.');

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

function enviarError(res, codigo, mensaje) {
  res.writeHead(codigo, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });
  res.end(`<h1>${codigo} ${mensaje}</h1>`);
}

const servidor = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let rutaRelativa = urlPath === '/' ? '/index.html' : urlPath;
  let rutaAbsoluta = path.join(DIRECTORY, rutaRelativa);

  // No permitir salir del directorio servido (../../etc).
  if (!rutaAbsoluta.startsWith(DIRECTORY)) {
    enviarError(res, 403, 'Forbidden');
    return;
  }

  fs.stat(rutaAbsoluta, (err, stats) => {
    if (err) {
      enviarError(res, 404, 'Not Found');
      return;
    }
    if (stats.isDirectory()) {
      rutaAbsoluta = path.join(rutaAbsoluta, 'index.html');
    }
    fs.readFile(rutaAbsoluta, (err, datos) => {
      if (err) {
        enviarError(res, 404, 'Not Found');
        return;
      }
      const ext = path.extname(rutaAbsoluta).toLowerCase();
      res.writeHead(200, {
        'Content-Type': TIPOS_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      });
      res.end(datos);
    });
  });
});

servidor.listen(PORT);
