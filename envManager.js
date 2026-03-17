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

let envConfig = {};

export function initEnvManager() {
    envConfig = {};
    for (const key of ENV_KEYS) {
        if (process.env[key] !== undefined) {
            envConfig[key] = process.env[key];
        }
    }
    applyProcessEnv();
}

export function applyProcessEnv() {
    for (const key of ENV_KEYS) {
        if (envConfig[key] !== undefined) process.env[key] = envConfig[key];
    }
}

export function getActiveEnv() {
    return process.env.ACTIVE_ENV === 'production' ? 'production' : 'stage';
}

export function getEnvConfig() {
    return envConfig;
}
