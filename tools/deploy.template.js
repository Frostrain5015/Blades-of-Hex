/**
 * Blades of Hex — 部署脚本
 *
 * 通过 SFTP 上传变更文件到服务器，然后 npm install + pm2 restart。
 *
 * 用法: node tools/deploy.js
 * 依赖: npm install ssh2
 */
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');

// ==== 配置 ====
const HOST = process.env.DEPLOY_HOST || "YOUR_SERVER_IP";
const USER = 'root';
const PASS = process.env.DEPLOY_PASS || "";
const REMOTE_DIR = '/root/blades-of-hex';
const LOCAL_DIR = path.resolve(__dirname, '..');

// 需要上传的文件列表（从 git diff --name-only 获取，或手动维护）
const files = [
    'server.js', 'package.json', 'package-lock.json', 'index.html',
    'css/style.css', 'css/auth.css',
    'js/config.js', 'js/gameLogic.js', 'js/input.js', 'js/main.js',
    'js/state.js', 'js/Unit.js', 'js/renderer.js', 'js/effects.js',
    'js/ai.js', 'js/audio.js', 'js/audioManifest.js',
    'js/commanderInterface.js', 'js/cheat.js', 'js/portraitLoader.js',
    'js/uid.js', 'js/HexTile.js', 'js/fogOfWar.js', 'js/network.js',
    'commander/advisor.js', 'commander/berserker.js', 'commander/centurion.js',
    'commander/fallenAngel.js', 'commander/ironGuard.js', 'commander/magician.js',
    'commander/martyr.js', 'commander/minister.js', 'commander/paladin.js',
    'commander/priest.js', 'commander/staller.js', 'commander/vampire.js',
'commander/index.js',
	    'commander/astrologer.js', 'commander/diplomat.js', 'commander/necromancer.js', 'commander/colonel.js',
	    'README.md'
];

// ==== SFTP 上传 ====
const conn = new Client();
let sftp = null;
let idx = 0;
let uploaded = 0;

function uploadNext() {
    if (idx >= files.length) {
        console.log(`\n=== Uploaded ${uploaded}/${files.length}. Running npm install + pm2 restart... ===`);
        const cmd = `cd ${REMOTE_DIR} && npm install --production 2>&1 && pm2 restart blades-of-hex 2>&1 && sleep 2 && pm2 status 2>&1`;
        conn.exec(cmd, (err, stream) => {
            stream.on('data', (d) => process.stdout.write(d.toString()));
            stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
            stream.on('close', (code) => { console.log('\n--- Exit code: ' + code + ' ---'); conn.end(); });
        });
        return;
    }
    const f = files[idx];
    const localPath = path.join(LOCAL_DIR, f);
    const remotePath = (REMOTE_DIR + '/' + f).replace(/\\/g, '/');

    if (!fs.existsSync(localPath)) {
        console.log('SKIP (not found): ' + f);
        idx++;
        uploadNext();
        return;
    }

    const rd = path.dirname(f);
    if (rd !== '.') {
        sftp.mkdir((REMOTE_DIR + '/' + rd).replace(/\\/g, '/'), { mode: 0o755 }, () => {});
    }

    setTimeout(() => {
        sftp.fastPut(localPath, remotePath, (err) => {
            if (err) { console.log('FAIL: ' + f); }
            else { console.log('OK: ' + f); uploaded++; }
            idx++;
            uploadNext();
        });
    }, 30);
}

conn.on('ready', () => {
    console.log('=== Connected, uploading ' + files.length + ' files ===');
    conn.sftp((err, sf) => {
        if (err) { console.error('SFTP error:', err); conn.end(); return; }
        sftp = sf;
        uploadNext();
    });
});
conn.on('error', (e) => { console.error('SSH Error:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
