// 零依赖静态文件服务器：服务整个项目根目录，
// 使 /prototype/akros-rpg/index.html 与 /img/commander/百夫长.webp 均可解析。
// 用法：node prototype/akros-rpg/serve.mjs  →  http://127.0.0.1:8322/
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, normalize, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT) || 8322;   // 可用 PORT=8323 避开占用

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('Not Found: ' + pathname); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`[akros-rpg] 已启动: http://127.0.0.1:${PORT}/prototype/akros-rpg/index.html`);
});
