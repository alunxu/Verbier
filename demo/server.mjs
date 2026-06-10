#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoDir = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(demoDir, '..');
const appDir = resolve(projectRoot, 'verbier-curator');
const publicDir = resolve(appDir, 'public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);

const photoRoot = '/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/verbier-1994-2022-photos/Photos';

const mounts = [
  { prefix: '/lens-assets', dir: resolve(projectRoot, 'reorchestrate-poc/lens-assets') },
  { prefix: '/lens-media', dir: resolve(projectRoot, 'media') },
  { prefix: '/verbier-photos', dir: photoRoot },
  { prefix: '/follow-video', dir: projectRoot },
];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.mid': 'audio/midi',
  '.mxl': 'application/vnd.recordare.musicxml',
  '.sf2': 'application/octet-stream',
};

function decodePath(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return null;
  }
}

function safeResolve(baseDir, urlPath) {
  const decoded = decodePath(urlPath);
  if (decoded === null) return null;

  const withoutQuery = decoded.split('?')[0].split('#')[0];
  const normalized = withoutQuery.replace(/^\/+/, '');
  const fullPath = resolve(baseDir, normalized);
  const baseWithSep = baseDir.endsWith(sep) ? baseDir : baseDir + sep;

  if (fullPath !== baseDir && !fullPath.startsWith(baseWithSep)) {
    return null;
  }
  return fullPath;
}

function candidateFor(pathname) {
  if (pathname === '/') {
    return {
      redirect: '/choose.html',
    };
  }

  for (const mount of mounts) {
    if (pathname === mount.prefix || pathname.startsWith(mount.prefix + '/')) {
      const rel = pathname.slice(mount.prefix.length) || '/';
      return { path: safeResolve(mount.dir, rel), mount: mount.prefix };
    }
  }

  const publicCandidate = safeResolve(publicDir, pathname);
  if (publicCandidate && existsSync(publicCandidate) && statSync(publicCandidate).isFile()) {
    return { path: publicCandidate, mount: 'public' };
  }

  return { path: safeResolve(appDir, pathname), mount: 'app' };
}

function serveFile(req, res, filePath) {
  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const type = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const commonHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start <= end && end < stat.size) {
        res.writeHead(206, {
          ...commonHeaders,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          createReadStream(filePath, { start, end }).pipe(res);
        }
        return;
      }
    }
  }

  res.writeHead(200, {
    ...commonHeaders,
    'Content-Length': stat.size,
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    createReadStream(filePath).pipe(res);
  }
}

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${host}:${port}`);
  const pathname = requestUrl.pathname;
  const candidate = candidateFor(pathname);

  if (candidate.redirect) {
    res.writeHead(302, { Location: candidate.redirect });
    res.end();
    return;
  }

  serveFile(req, res, candidate.path);
});

server.listen(port, host, () => {
  console.log('Verbier Curator demo server');
  console.log(`Project root: ${projectRoot}`);
  console.log(`Listening at: http://${host}:${port}/choose.html`);
  console.log('');
  console.log('Recommended reviewer path:');
  console.log(`  http://${host}:${port}/choose.html`);
  console.log(`  http://${host}:${port}/become-conductor.html`);
  console.log(`  http://${host}:${port}/follow.html`);
  console.log('');
  console.log('Press Ctrl+C to stop.');
});
