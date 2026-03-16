import pg from 'pg';

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err);
});

/**
 * Find an organization ID by its name.
 * Fetches up to 10 matches and picks the most recently created one.
 * Retries up to 5 times with 2s delay to handle DB replication / write lag.
 */
export async function findOrgIdByName(name) {
    const trimmed = name.trim();
    for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await pool.query(
            'SELECT id FROM organizations WHERE TRIM(name) = $1 ORDER BY created_at DESC LIMIT 1',
            [trimmed]
        );
        if (result.rows.length > 0) {
            const id = String(result.rows[0].id);
            if (result.rows.length > 1) {
                console.log(`[DB] Found ${result.rows.length} orgs named "${trimmed}", using most recent (ID: ${id})`);
            }
            return id;
        }
        console.log(`[DB] Attempt ${attempt}/5: org "${trimmed}" not found yet, retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
    }
    return null;
}

/**
 * Find a company ID by its name (optionally scoped to an org).
 * Retries up to 5 times with 5s delay to handle DB replication / write lag.
 */
export async function findCompanyIdByName(name, orgId = null) {
    const trimmed = name.trim();
    for (let attempt = 1; attempt <= 8; attempt++) {
        let result;
        if (orgId) {
            result = await pool.query(
                'SELECT id FROM companies WHERE TRIM(name) = $1 AND organization_id = $2 ORDER BY id DESC LIMIT 1',
                [trimmed, orgId]
            );
        } else {
            result = await pool.query(
                'SELECT id FROM companies WHERE TRIM(name) = $1 ORDER BY id DESC LIMIT 1',
                [trimmed]
            );
        }
        if (result.rows.length > 0) {
            const id = String(result.rows[0].id);
            if (result.rows.length > 1) {
                console.log(`[DB] Found ${result.rows.length} companies named "${trimmed}", using most recent (ID: ${id})`);
            }
            return id;
        }
        console.log(`[DB] Attempt ${attempt}/8: company "${trimmed}" not found yet, retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
    }
    return null;
}

export { pool };
export default pool;
