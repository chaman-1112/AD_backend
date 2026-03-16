import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENV_KEYS = [
    'STAGE_BASE_URL',
    'STAGE_SUPERADMIN_EMAIL',
    'STAGE_SUPERADMIN_PASSWORD',
    'STAGE_EDIT_ORG_ID',
    'STAGE_HTTP_USERNAME',
    'STAGE_HTTP_PASSWORD',
    'STAGE_DATA_HTTP_USERNAME',
    'STAGE_DATA_HTTP_PASSWORD',
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'CLOUDFRONT_BASE',
];

let activeEnv = 'stage';
let envConfigByName = {
    stage: {},
    production: {},
};

function parseBlock(content, name) {
    const pattern = name === 'production'
        ? /# ---- BEGIN PRODUCTION ----\r?\n([\s\S]*?)# ---- END PRODUCTION ----/
        : /# ---- BEGIN STAGE ----\r?\n([\s\S]*?)# ---- END STAGE ----/;
    const match = content.match(pattern);
    if (!match) return {};

    const cfg = {};
    for (const rawLine of match[1].split(/\r?\n/)) {
        const line = rawLine.trim().replace(/^#\s?/, '');
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) continue;
        cfg[key] = value;
    }
    return cfg;
}

function parseActiveMarker(content) {
    const marker = content.match(/^#\s*ACTIVE_ENV\s*=\s*(\S+)/m);
    if (!marker) return 'stage';
    return marker[1] === 'production' ? 'production' : 'stage';
}

export function initEnvManager(envPath) {
    const resolvedPath = resolve(envPath);
    const content = readFileSync(resolvedPath, 'utf-8');
    const stage = parseBlock(content, 'stage');
    const production = parseBlock(content, 'production');
    activeEnv = parseActiveMarker(content);
    envConfigByName = { stage, production };

    applyProcessEnv(activeEnv);
}

export function applyProcessEnv(name) {
    const selected = envConfigByName[name] || {};
    for (const key of ENV_KEYS) {
        if (selected[key] !== undefined) process.env[key] = selected[key];
    }
}

export function switchActiveEnv(name) {
    if (name !== 'stage' && name !== 'production') {
        throw new Error('env must be "stage" or "production"');
    }
    activeEnv = name;
    applyProcessEnv(name);
    return { env: activeEnv };
}

export function getActiveEnv() {
    return activeEnv;
}

export function getEnvConfig(name = activeEnv) {
    return envConfigByName[name] || {};
}
