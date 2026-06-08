import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, createReadStream, statSync } from 'fs';

// Static-mount plugin for serving files OUTSIDE Vite's project root
// (the lens-assets and lens-media folders live in ../reorchestrate-poc/
// and ../media respectively). Symlinks in publicDir don't work reliably,
// so we add explicit handlers.
function externalStaticMounts(mounts) {
    return {
        name: 'external-static-mounts',
        configureServer(server) {
            const mimes = {
                '.json': 'application/json',
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg',
                '.ogg': 'audio/ogg',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
            };
            server.middlewares.use((req, res, next) => {
                for (const { urlPrefix, fsPath } of mounts) {
                    if (req.url.startsWith(urlPrefix)) {
                        const rel = decodeURIComponent(req.url.slice(urlPrefix.length).split('?')[0]);
                        const full = resolve(fsPath, '.' + rel);
                        if (existsSync(full) && statSync(full).isFile()) {
                            const ext = full.slice(full.lastIndexOf('.'));
                            res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
                            res.setHeader('Accept-Ranges', 'bytes');
                            res.setHeader('Content-Length', statSync(full).size);
                            createReadStream(full).pipe(res);
                            return;
                        }
                    }
                }
                next();
            });
        }
    };
}

const projectRoot = resolve(__dirname, '..');

export default defineConfig({
    base: './',
    root: '.',
    publicDir: 'public',
    plugins: [
        externalStaticMounts([
            { urlPrefix: '/lens-assets', fsPath: resolve(projectRoot, 'reorchestrate-poc/lens-assets') },
            { urlPrefix: '/lens-media',  fsPath: resolve(projectRoot, 'media') },
            { urlPrefix: '/verbier-photos', fsPath: resolve(projectRoot, '../../Datasets/Verbier Archive/verbier-1994-2022-photos/Photos') },
            { urlPrefix: '/follow-video', fsPath: projectRoot },
        ])
    ],
    server: {
        port: 5173,
        open: true,
        fs: {
            allow: ['..', '../..']
        }
    },
    build: {
        outDir: 'dist',
        assetsInlineLimit: 0
    },
    assetsInclude: ['**/*.ogg', '**/*.mp3', '**/*.wav', '**/*.mp4', '**/*.webm']
});
