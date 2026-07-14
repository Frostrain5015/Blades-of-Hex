import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { cp, copyFile, mkdir } from 'node:fs/promises';

const entry = relativePath => fileURLToPath(new URL(relativePath, import.meta.url));

function copyRuntimeStaticAssets() {
    const directories = ['img', 'sounds', 'js/lib', 'campaign/content'];
    const files = ['campaign/terrain-preview-shared.js'];
    return {
        name: 'copy-runtime-static-assets',
        apply: 'build',
        async closeBundle() {
            await Promise.all(directories.map(async relativePath => {
                await cp(entry(`./${relativePath}`), entry(`./dist/${relativePath}`), {
                    recursive: true,
                    force: true
                });
            }));
            await Promise.all(files.map(async relativePath => {
                const destination = entry(`./dist/${relativePath}`);
                await mkdir(fileURLToPath(new URL('./', new URL(`./dist/${relativePath}`, import.meta.url))), {
                    recursive: true
                });
                await copyFile(entry(`./${relativePath}`), destination);
            }));
        }
    };
}

export default defineConfig({
    // Keep URLs identical to the existing Node static server so built and
    // unbuilt clients can coexist during the renderer migration.
    base: '/',
    publicDir: false,
    plugins: [copyRuntimeStaticAssets()],
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: false,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
            '/auth': 'http://127.0.0.1:3000'
        }
    },
    preview: {
        host: '127.0.0.1',
        port: 4173,
        strictPort: false
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        manifest: true,
        target: 'es2022',
        rollupOptions: {
            input: {
                game: entry('./index.html'),
                terrainPreview: entry('./campaign/terrain-texture-preview.html'),
                terrain: entry('./campaign/terrain-preview-terrain.html'),
                actions: entry('./campaign/terrain-preview-actions.html'),
                targeting: entry('./campaign/terrain-preview-targeting.html'),
                air: entry('./campaign/terrain-preview-air.html'),
                water: entry('./campaign/terrain-preview-water.html')
            },
            output: {
                manualChunks(id) {
                    // Keep Vite's dynamic-import helper out of the optional Pixi
                    // chunk. If Rollup adopts the helper into `pixi`, the game
                    // entry gains a static import and eagerly downloads the
                    // entire GPU backend even while Canvas2D is selected.
                    if (id.includes('vite/preload-helper')) return 'vite-preload';
                    if (id.includes('/node_modules/pixi.js/') || id.includes('\\node_modules\\pixi.js\\')) return 'pixi';
                    if (id.includes('/campaign/editor/') || id.includes('\\campaign\\editor\\')) return 'campaign-editor';
                    if (id.includes('/campaign/runtime/') || id.includes('\\campaign\\runtime\\')) return 'campaign-runtime';
                    return undefined;
                }
            }
        }
    }
});
