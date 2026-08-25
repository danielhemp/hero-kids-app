/**
 * A static server for dist/, shared by the end-to-end scripts so each one is a
 * single command rather than "remember to start the preview server first".
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export async function serveDist() {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('no dist/ — run `npm run build` first');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    // Anything unknown falls back to the app shell, as a static host would.
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      file = path.join(dist, 'index.html');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  const port = await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}
