import pg from 'pg';

let currentPool = null;
let dbConnected = false;
let lastPoolError = 0;
const POOL_ERROR_THROTTLE_MS = 10000;

function withPoolLogging(pool) {
    pool.on('error', (err) => {
        const now = Date.now();
        if (now - lastPoolError > POOL_ERROR_THROTTLE_MS) {
            lastPoolError = now;
            console.error(`  [DB Pool] ${err.code || 'ERROR'}: ${err.message}`);
        }
    });
}

function createDbConfig(overrides = {}) {
    const host = overrides.DB_HOST || process.env.DB_HOST;
    const port = parseInt(overrides.DB_PORT || process.env.DB_PORT || '5432', 10);
    const database = overrides.DB_NAME || process.env.DB_NAME;
    const user = overrides.DB_USER || process.env.DB_USER;
    const password = overrides.DB_PASSWORD || process.env.DB_PASSWORD;

    return {
        host,
        port,
        database,
        user,
        password,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 30000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        allowExitOnIdle: false,
    };
}

export async function switchDbConfig(overrides = {}) {
    const dbConfig = createDbConfig(overrides);
    console.log(`  DB config: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

    const newPool = new pg.Pool(dbConfig);
    withPoolLogging(newPool);

    const client = await newPool.connect();
    try {
        const res = await client.query('SELECT NOW()');
        dbConnected = true;
        console.log(`  DB connected successfully at ${res.rows[0].now}`);
    } finally {
        client.release();
    }

    const oldPool = currentPool;
    currentPool = newPool;
    if (oldPool) {
        oldPool.end().catch(() => {});
    }
}

export function getPool() {
    if (!currentPool) throw new Error('Database pool not initialized');
    return currentPool;
}

export async function dbQuery(text, params) {
    return getPool().query(text, params);
}

const poolProxy = {
    query: (...args) => dbQuery(...args),
    connect: (...args) => getPool().connect(...args),
};

export { dbConnected };
export default poolProxy;
