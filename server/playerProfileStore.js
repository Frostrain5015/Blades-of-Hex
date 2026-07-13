const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PROFILE_SCHEMA_VERSION = 2;
const TABLE_NAME = 'blades_of_hex_player_profiles';

function readEnvValue(filePath, key) {
    if (!filePath || !fs.existsSync(filePath)) return '';
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const separator = trimmed.indexOf('=');
            if (separator < 1 || trimmed.slice(0, separator).trim() !== key) continue;
            const raw = trimmed.slice(separator + 1).trim();
            return raw.replace(/^(['"])(.*)\1$/, '$2');
        }
    } catch (_) {
        return '';
    }
    return '';
}

function resolveDatabaseUrl(explicitUrl = '') {
    const direct = explicitUrl
        || process.env.BOH_FROST_ID_DATABASE_URL
        || process.env.FROST_ID_DATABASE_URL
        || process.env.DATABASE_URL;
    if (direct) return direct;

    const candidates = [
        process.env.FROST_ID_ENV_PATH,
        path.resolve(__dirname, '..', '..', 'frost-id', '.env'),
        path.resolve(__dirname, '..', '..', 'Frost ID', '.env')
    ].filter(Boolean);
    for (const candidate of candidates) {
        const value = readEnvValue(candidate, 'DATABASE_URL');
        if (value) return value;
    }
    return '';
}

function emptyProfile() {
    return {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        campaigns: {},
        standardFlagPreferences: {}
    };
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProfile(value) {
    if (!isRecord(value) || Number(value.schemaVersion) !== PROFILE_SCHEMA_VERSION) return emptyProfile();
    return {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        campaigns: isRecord(value.campaigns) ? value.campaigns : {},
        standardFlagPreferences: isRecord(value.standardFlagPreferences) ? value.standardFlagPreferences : {}
    };
}

function createPlayerProfileStore({ databaseUrl = '' } = {}) {
    const resolvedUrl = resolveDatabaseUrl(databaseUrl);
    let pool = null;
    let initialized = null;

    async function ensureReady() {
        if (!resolvedUrl) throw new Error('Frost ID database URL is not configured');
        if (!pool) {
            pool = mysql.createPool({
                uri: resolvedUrl,
                waitForConnections: true,
                connectionLimit: 5,
                enableKeepAlive: true
            });
        }
        if (!initialized) {
            initialized = pool.execute(`
                CREATE TABLE IF NOT EXISTS \`${TABLE_NAME}\` (
                    \`user_id\` VARCHAR(36) NOT NULL,
                    \`schema_version\` INT NOT NULL,
                    \`profile_json\` JSON NOT NULL,
                    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (\`user_id\`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `).catch(error => {
                initialized = null;
                throw error;
            });
        }
        await initialized;
    }

    async function read(userId) {
        await ensureReady();
        const [rows] = await pool.execute(
            `SELECT \`schema_version\`, \`profile_json\` FROM \`${TABLE_NAME}\` WHERE \`user_id\` = ? LIMIT 1`,
            [userId]
        );
        if (!rows.length || Number(rows[0].schema_version) !== PROFILE_SCHEMA_VERSION) return emptyProfile();
        const raw = typeof rows[0].profile_json === 'string'
            ? JSON.parse(rows[0].profile_json)
            : rows[0].profile_json;
        return normalizeProfile(raw);
    }

    async function write(userId, profile) {
        await ensureReady();
        const normalized = normalizeProfile(profile);
        await pool.execute(
            `INSERT INTO \`${TABLE_NAME}\` (\`user_id\`, \`schema_version\`, \`profile_json\`)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                \`schema_version\` = VALUES(\`schema_version\`),
                \`profile_json\` = VALUES(\`profile_json\`),
                \`updated_at\` = CURRENT_TIMESTAMP`,
            [userId, PROFILE_SCHEMA_VERSION, JSON.stringify(normalized)]
        );
        return normalized;
    }

    return {
        configured: Boolean(resolvedUrl),
        read,
        write
    };
}

module.exports = {
    PROFILE_SCHEMA_VERSION,
    createPlayerProfileStore,
    emptyProfile,
    normalizeProfile,
    resolveDatabaseUrl
};
