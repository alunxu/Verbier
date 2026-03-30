import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    publicDir: 'public',
    server: {
        port: 5173,
        open: true,
        fs: {
            allow: ['..']
        }
    },
    build: {
        outDir: 'dist',
        assetsInlineLimit: 0
    },
    assetsInclude: ['**/*.ogg', '**/*.mp3', '**/*.wav', '**/*.mp4', '**/*.webm']
});
