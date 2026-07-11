// tools/generateAssetManifest.mjs — 生成静态资源版本清单，替代手动改 `main.js?v=22`。
// 用法：node tools/generateAssetManifest.mjs
//   1. 扫描 js/、rules/、commander/、core/ 与根目录 css/html 之外的静态入口资源，
//      计算内容哈希（sha1 前 10 位）写入 asset-manifest.json；
//   2. 将 index.html 中形如 `js/main.js?v=xxx` 的版本参数改写为主入口的内容哈希。
// 不引入构建工具；服务器与页面结构保持不变。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_DIRS = ['js', 'rules', 'commander', 'core', 'engine', 'protocol'];
const SCAN_FILES = ['style.css', 'index.html'];

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) yield* walk(full);
        else yield full;
    }
}

function hashOf(file) {
    return createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);
}

const manifest = {};
for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
        if (!/\.(js|mjs|css|json)$/.test(file)) continue;
        const rel = relative(root, file).split(sep).join('/');
        manifest[rel] = hashOf(file);
    }
}
for (const f of SCAN_FILES) {
    try { manifest[f] = hashOf(join(root, f)); } catch { /* 可选文件 */ }
}

// 主入口版本 = js/ + rules/ + commander/ 全部模块哈希的组合（任一模块变动即失效缓存）
const moduleHashes = Object.entries(manifest)
    .filter(([k]) => /^(js|rules|commander|core|engine|protocol)\//.test(k))
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join('|');
const entryVersion = createHash('sha1').update(moduleHashes).digest('hex').slice(0, 10);

writeFileSync(join(root, 'asset-manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    entryVersion,
    files: manifest
}, null, 2), 'utf8');

// 改写 index.html 的入口版本参数
const indexPath = join(root, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const updated = html.replace(/(src="js\/main\.js\?v=)[^"]*(")/, `$1${entryVersion}$2`);
if (updated !== html) {
    writeFileSync(indexPath, updated, 'utf8');
    console.log(`index.html 入口版本 → ?v=${entryVersion}`);
} else {
    console.log('index.html 未发现 js/main.js?v= 入口标记，跳过改写');
}
console.log(`已生成 asset-manifest.json（${Object.keys(manifest).length} 个文件）`);
