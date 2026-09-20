import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { cp, copyFile, mkdir } from 'node:fs/promises';

const entry = relativePath => fileURLToPath(new URL(relativePath, import.meta.url));

function copyRuntimeStaticAssets(outDir) {
    const directories = ['img', 'sounds', 'js/lib', 'campaign/content'];
    const files = ['campaign/terrain-preview-shared.js'];
    return {
        name: 'copy-runtime-static-assets',
        apply: 'build',
        async closeBundle() {
            await Promise.all(directories.map(async relativePath => {
                await cp(entry(`./${relativePath}`), entry(`./${outDir}/${relativePath}`), {
                    recursive: true,
                    force: true
                });
            }));
            await Promise.all(files.map(async relativePath => {
                const destination = entry(`./${outDir}/${relativePath}`);
                await mkdir(fileURLToPath(new URL('./', new URL(`./${outDir}/${relativePath}`, import.meta.url))), {
                    recursive: true
                });
                await copyFile(entry(`./${relativePath}`), destination);
            }));
        }
    };
}

export default defineConfig(({ mode }) => {
    const itchBuild = mode === 'itch';
    const outDir = itchBuild ? 'dist-itch' : 'dist';

    return {
        // The cloud build keeps root-relative URLs for the Node static server.
        // itch.io hosts HTML games below a CDN subdirectory, so that build must
        // use relative asset URLs.
        base: itchBuild ? './' : '/',
        publicDir: false,
        plugins: [copyRuntimeStaticAssets(outDir)],
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
            outDir,
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
                        // Keep Vite's dynamic-import helper out of the Pixi chunk
                        // so the engine remains an isolated backend bundle.
                        if (id.includes('vite/preload-helper')) return 'vite-preload';
                        if (id.includes('/node_modules/pixi.js/') || id.includes('\\node_modules\\pixi.js\\')) return 'pixi';
                        if (id.includes('/campaign/editor/') || id.includes('\\campaign\\editor\\')) return 'campaign-editor';
                        if (id.includes('/campaign/runtime/') || id.includes('\\campaign\\runtime\\')) return 'campaign-runtime';
                        if (id.includes('/node_modules/ai/')) return 'campaign-ai';
                        // Rules modules go to a shared chunk to prevent circular
                        // dependencies between campaign-editor and campaign-runtime
                        // (both import rules/ modules like naval.js).
                        if (id.includes('/rules/') || id.includes('\\rules\\')) return 'game-rules';
                        return undefined;
                    }
                }
            }
        }
    };
});
