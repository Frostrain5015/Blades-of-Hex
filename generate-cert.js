/**
 * 自签名证书生成脚本
 * 优先使用 OpenSSL，其次使用 Node.js crypto（无需额外依赖）
 *
 * 用法: node generate-cert.js [--force]
 * 输出: certs/cert.pem  certs/key.pem
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CERTS_DIR = path.join(__dirname, 'certs');
const CERT_FILE = path.join(CERTS_DIR, 'cert.pem');
const KEY_FILE = path.join(CERTS_DIR, 'key.pem');
const FORCE = process.argv.includes('--force');

function ensureDir() {
    if (!fs.existsSync(CERTS_DIR)) fs.mkdirSync(CERTS_DIR, { recursive: true });
}

function certsExist() {
    return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
}

function tryOpenSSL() {
    try {
        execSync('openssl version', { stdio: 'pipe' });
    } catch {
        return false;
    }
    console.log('使用 OpenSSL 生成证书...');
    execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" -days 3650 -nodes -subj "/CN=BladesOfHex"`,
        { stdio: 'inherit' }
    );
    return true;
}

/**
 * 纯 Node.js 生成 X.509 自签名证书（基于 RFC 5280 最小实现）
 */
function generateWithNode() {
    console.log('使用 Node.js crypto 生成证书...');

    // 生成 RSA 密钥对
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    // 提取公钥的 DER 编码，去掉 SPKI 包装得到 SubjectPublicKeyInfo
    const pubDer = Buffer.from(publicKey);

    // 解析 SubjectPublicKeyInfo 获取 modulus 和 exponent
    // SPKI 结构: SEQUENCE { AlgorithmIdentifier SEQUENCE { OID, NULL }, BIT STRING { RSAPublicKey } }
    function readDERLength(buf, offset) {
        let len = buf[offset++];
        if (len < 0x80) return { len, offset };
        const numBytes = len & 0x7f;
        len = 0;
        for (let i = 0; i < numBytes; i++) {
            len = (len << 8) | buf[offset++];
        }
        return { len, offset };
    }

    function getRSAPublicKeyComponents(spkiDer) {
        let off = 0;
        // Skip SEQUENCE tag and length
        if (spkiDer[off] !== 0x30) throw new Error('Expected SEQUENCE');
        off++;
        let r = readDERLength(spkiDer, off);
        off = r.offset;

        // AlgorithmIdentifier SEQUENCE
        off += 2; // skip SEQUENCE tag+len (OID+NULL = ~15 bytes, fits in short form)
        const algLen = spkiDer[off - 1];
        off += algLen;

        // BIT STRING containing RSAPublicKey
        if (spkiDer[off] !== 0x03) throw new Error('Expected BIT STRING');
        off++;
        r = readDERLength(spkiDer, off);
        off = r.offset + 1; // skip unused bits byte

        // Now we're at RSAPublicKey SEQUENCE
        if (spkiDer[off] !== 0x30) throw new Error('Expected SEQUENCE in RSAPublicKey');
        off++;
        r = readDERLength(spkiDer, off);
        off = r.offset;

        // Modulus INTEGER
        if (spkiDer[off] !== 0x02) throw new Error('Expected INTEGER (modulus)');
        off++;
        r = readDERLength(spkiDer, off);
        off = r.offset;
        const modulus = spkiDer.subarray(off, off + r.len);
        off += r.len;

        // Exponent INTEGER
        if (spkiDer[off] !== 0x02) throw new Error('Expected INTEGER (exponent)');
        off++;
        r = readDERLength(spkiDer, off);
        off = r.offset;
        const exponent = spkiDer.subarray(off, off + r.len);

        return { modulus, exponent };
    }

    const keyComponents = getRSAPublicKeyComponents(pubDer);

    // Build TBSCertificate manually using DER encoding
    function encodeDERLength(len) {
        if (len < 0x80) return Buffer.from([len]);
        const bytes = [];
        let remaining = len;
        while (remaining > 0) {
            bytes.unshift(remaining & 0xff);
            remaining >>>= 8;
        }
        return Buffer.from([0x80 | bytes.length, ...bytes]);
    }

    function encodeInteger(buf) {
        // Strip leading zeros (but keep at least one, and ensure positive if MSB is set)
        let start = 0;
        while (start < buf.length - 1 && buf[start] === 0) start++;
        let val = buf.subarray(start);
        if (val[0] & 0x80) {
            val = Buffer.concat([Buffer.from([0]), val]);
        }
        const tag = Buffer.from([0x02]);
        const len = encodeDERLength(val.length);
        return Buffer.concat([tag, len, val]);
    }

    // Serial number (random 8 bytes)
    const serial = crypto.randomBytes(8);
    if (serial[0] & 0x80) serial[0] &= 0x7f; // ensure positive

    // Validity: now to now + 10 years
    const now = new Date();
    const notBefore = now;
    const notAfter = new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000);

    function encodeUTCTime(d) {
        const y = d.getUTCFullYear().toString().slice(-2);
        const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = d.getUTCDate().toString().padStart(2, '0');
        const h = d.getUTCHours().toString().padStart(2, '0');
        const min = d.getUTCMinutes().toString().padStart(2, '0');
        const s = d.getUTCSeconds().toString().padStart(2, '0');
        return Buffer.from(`${y}${m}${day}${h}${min}${s}Z`, 'ascii');
    }

    // Subject / Issuer name (same for self-signed)
    const cn = encodeUTF8String('BladesOfHex');
    const nameSeq = encodeDERSequence(Buffer.concat([
        encodeSET(Buffer.concat([cn])),
    ]));

    function encodeUTF8String(str) {
        const buf = Buffer.from(str, 'utf8');
        return Buffer.concat([
            Buffer.from([0x0c]), // UTF8String tag
            encodeDERLength(buf.length),
            buf,
        ]);
    }

    function encodeOID(oid) {
        const parts = oid.split('.').map(Number);
        const out = [parts[0] * 40 + parts[1]];
        for (let i = 2; i < parts.length; i++) {
            let v = parts[i];
            const bytes = [];
            do {
                bytes.unshift(v & 0x7f);
                v >>>= 7;
            } while (v > 0);
            for (let j = 0; j < bytes.length - 1; j++) bytes[j] |= 0x80;
            out.push(...bytes);
        }
        return Buffer.from([0x06, ...encodeDERLength(out.length), ...out]);
    }

    function encodeSET(items) {
        return Buffer.concat([Buffer.from([0x31]), encodeDERLength(items.length), items]);
    }

    function encodeDERSequence(items) {
        return Buffer.concat([Buffer.from([0x30]), encodeDERLength(items.length), items]);
    }

    function encodeNameAttribute(oid, value) {
        return encodeDERSequence(Buffer.concat([encodeOID(oid), value]));
    }

    // Build proper subject name
    const subjectAttr = encodeNameAttribute('2.5.4.3', encodeUTF8String('BladesOfHex'));
    const subjectName = encodeDERSequence(encodeSET(subjectAttr));
    const issuerName = subjectName; // self-signed

    // SPKI for TBS (from the public key we generated)
    const spkiForTbs = pubDer; // already a proper SubjectPublicKeyInfo DER

    // Build TBSCertificate
    const version = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]); // v3
    const tbsContent = Buffer.concat([
        version,
        encodeInteger(serial),
        // Signature algorithm: sha256WithRSAEncryption
        Buffer.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b, 0x05, 0x00]),
        issuerName,
        encodeDERSequence(Buffer.concat([
            Buffer.from([0x17, 0x0d]), // UTCTime tag
            encodeUTCTime(notBefore),
            Buffer.from([0x17, 0x0d]), // UTCTime tag
            encodeUTCTime(notAfter),
        ])),
        subjectName,
        spkiForTbs,
    ]);

    const tbsCert = encodeDERSequence(tbsContent);

    // Sign with SHA-256
    const sign = crypto.createSign('SHA256');
    sign.update(tbsCert);
    const signature = sign.sign({ key: crypto.createPrivateKey({
        key: Buffer.from(privateKey),
        format: 'der',
        type: 'pkcs8',
    }), dsaEncoding: 'ieee-p1363' });

    // Encode signature as BIT STRING
    const sigInt = encodeInteger(Buffer.from(signature));
    const sigBitStr = Buffer.concat([Buffer.from([0x03]), encodeDERLength(sigInt.length + 1), Buffer.from([0x00]), sigInt]);

    // Full certificate
    const sigAlg = Buffer.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b, 0x05, 0x00]);
    const certDer = encodeDERSequence(Buffer.concat([tbsCert, sigAlg, sigBitStr]));

    const certPem = '-----BEGIN CERTIFICATE-----\n' +
        certDer.toString('base64').match(/.{1,64}/g).join('\n') +
        '\n-----END CERTIFICATE-----\n';

    const keyPem = crypto.createPrivateKey({
        key: Buffer.from(privateKey),
        format: 'der',
        type: 'pkcs8',
    }).export({ type: 'pkcs8', format: 'pem' });

    fs.writeFileSync(CERT_FILE, certPem);
    fs.writeFileSync(KEY_FILE, keyPem);
}

// ==== Main ====
if (!FORCE && certsExist()) {
    console.log('证书已存在 (certs/cert.pem, certs/key.pem)。使用 --force 强制重新生成。');
    process.exit(0);
}

ensureDir();

if (!tryOpenSSL()) {
    console.log('未检测到 OpenSSL，切换到 Node.js 内置生成...');
    generateWithNode();
}

console.log('');
console.log('✅ 证书生成成功:');
console.log(`   证书: ${CERT_FILE}`);
console.log(`   私钥: ${KEY_FILE}`);
console.log('');
console.log('启动服务器后将自动启用 HTTPS（端口 3443）。');
console.log('自签名证书浏览器会提示不安全，点击"高级"→"继续访问"即可。');
