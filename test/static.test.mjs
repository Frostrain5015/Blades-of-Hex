// 静态审计套件：全量语法检查 + 本地模块 import/export 交叉审计
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execFileSync } from 'child_process';
import { Reporter } from './lib/helpers.mjs';

export async function run() {
    const R = new Reporter('static');
    const ROOT = process.cwd();

    const files = [];
    function walk(dir) {
        for (const f of readdirSync(dir)) {
            const p = join(dir, f);
            if (statSync(p).isDirectory()) {
                if (!f.startsWith('.') && f !== 'node_modules' && f !== 'lib') walk(p);
            } else if (f.endsWith('.js')) files.push(p);
        }
    }
    for (const dir of ['js', 'rules', 'commander', 'core', 'engine', 'protocol', 'ai', 'campaign']) {
        walk(join(ROOT, dir));
    }

    // 1) 语法检查
    let synErr = 0;
    for (const fp of files) {
        try { execFileSync(process.execPath, ['--check', fp], { stdio: 'pipe' }); }
        catch (e) { synErr++; console.log(`  ✗ 语法错误: ${fp}\n${e.stderr}`); }
    }
    R.assert(synErr === 0, `语法检查（${files.length} 个文件）`);

    // 2) import/export 交叉审计
    const exportsOf = new Map();
    function getExports(fp) {
        if (exportsOf.has(fp)) return exportsOf.get(fp);
        let src; try { src = readFileSync(fp, 'utf8'); } catch { exportsOf.set(fp, null); return null; }
        const s = new Set();
        for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/g)) s.add(m[1]);
        for (const m of src.matchAll(/export\s*\{([^}]+)\}/g))
            m[1].split(',').forEach(n => { const p = n.trim().split(/\s+as\s+/); if (p[p.length - 1]) s.add(p[p.length - 1].trim()); });
        if (/export\s+default/.test(src)) s.add('default');
        exportsOf.set(fp, s); return s;
    }
    let impErr = 0;
    for (const fp of files) {
        const src = readFileSync(fp, 'utf8');
        for (const m of src.matchAll(/import\s*(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"](\.[^'"]+)['"]/g)) {
            const target = resolve(dirname(fp), m[3]);
            const ex = getExports(target);
            if (ex === null) { impErr++; console.log(`  ✗ ${fp}: 无法解析 ${m[3]}`); continue; }
            const names = [];
            if (m[1]) names.push('default');
            if (m[2]) m[2].split(',').forEach(n => { const nm = n.trim().split(/\s+as\s+/)[0].trim(); if (nm) names.push(nm); });
            for (const nm of names) if (!ex.has(nm)) { impErr++; console.log(`  ✗ ${fp.replace(ROOT, '')} 从 ${m[3]} 导入了不存在的 ${nm}`); }
        }
    }
    R.assert(impErr === 0, `import/export 交叉审计（${files.length} 个文件）`);

    return R.summary();
}
