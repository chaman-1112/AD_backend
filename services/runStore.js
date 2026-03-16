import { dbQuery } from '../db.js';

function isMissingTableError(err) {
    return err?.code === '42P01' || /relation .* does not exist/i.test(err?.message || '');
}

async function safeQuery(text, params = []) {
    try {
        return await dbQuery(text, params);
    } catch (err) {
        if (isMissingTableError(err)) return { rows: [], rowCount: 0 };
        throw err;
    }
}

function toStatus(status) {
    return status || 'pending';
}

function normalizeRunRow(row) {
    return {
        id: row.id,
        mode: row.mode,
        label: row.label,
        status: row.status,
        userId: row.user_id,
        orgId: row.org_id,
        user: row.user_name,
        userEmail: row.user_email,
        request: row.request_json || {},
        resultMessage: row.result_message || null,
        activeEnv: row.active_env || null,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        steps: Array.isArray(row.steps) ? row.steps : [],
    };
}

export async function createRun(payload) {
    const {
        id,
        mode,
        label,
        status = 'running',
        userId = null,
        orgId = null,
        userName = null,
        userEmail = null,
        request = null,
        activeEnv = null,
    } = payload;

    await safeQuery(
        `INSERT INTO runs (
            id, mode, label, status, user_id, org_id, user_name, user_email, request_json, active_env, started_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,NOW())
        ON CONFLICT (id) DO UPDATE SET
            mode = EXCLUDED.mode,
            label = EXCLUDED.label,
            status = EXCLUDED.status,
            user_id = EXCLUDED.user_id,
            org_id = EXCLUDED.org_id,
            user_name = EXCLUDED.user_name,
            user_email = EXCLUDED.user_email,
            request_json = EXCLUDED.request_json,
            active_env = EXCLUDED.active_env`,
        [id, mode, label, status, userId, orgId, userName, userEmail, JSON.stringify(request || {}), activeEnv]
    );
}

export async function upsertStep(runId, step, seq = 0) {
    await safeQuery(
        `INSERT INTO run_steps (run_id, step_id, label, status, duration_ms, error_text, seq, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (run_id, step_id) DO UPDATE SET
            label = EXCLUDED.label,
            status = EXCLUDED.status,
            duration_ms = EXCLUDED.duration_ms,
            error_text = EXCLUDED.error_text,
            seq = EXCLUDED.seq,
            updated_at = NOW()`,
        [
            runId,
            step.stepId || step.id,
            step.label || null,
            toStatus(step.status),
            step.duration || step.duration_ms || null,
            step.error || null,
            seq,
        ]
    );
}

export async function addEvent(runId, event) {
    await safeQuery(
        `INSERT INTO run_events (run_id, ts, type, message) VALUES ($1, NOW(), $2, $3)`,
        [runId, event.type || 'log', String(event.message || '')]
    );
}

export async function finalizeRun(runId, { status, resultMessage = null } = {}) {
    await safeQuery(
        `UPDATE runs SET status = COALESCE($2, status), result_message = $3, ended_at = NOW() WHERE id = $1`,
        [runId, status || null, resultMessage]
    );
}

export async function listRuns({ status, mode, q, limit = 50, offset = 0, orgScope = [] }) {
    const values = [];
    const where = [];

    if (status) {
        values.push(status);
        where.push(`r.status = $${values.length}`);
    }
    if (mode) {
        values.push(mode);
        where.push(`r.mode = $${values.length}`);
    }
    if (q) {
        values.push(`%${q}%`);
        where.push(`(r.label ILIKE $${values.length} OR COALESCE(r.user_name,'') ILIKE $${values.length} OR COALESCE(r.user_email,'') ILIKE $${values.length})`);
    }
    if (Array.isArray(orgScope) && orgScope.length > 0) {
        values.push(orgScope);
        where.push(`(r.org_id = ANY($${values.length}::bigint[]) OR r.org_id IS NULL)`);
    }

    values.push(limit);
    values.push(offset);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await safeQuery(
        `SELECT
            r.*,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', s.step_id,
                        'label', s.label,
                        'status', s.status,
                        'duration', s.duration_ms,
                        'error', s.error_text
                    ) ORDER BY s.seq
                ) FILTER (WHERE s.run_id IS NOT NULL),
                '[]'::json
            ) AS steps
         FROM runs r
         LEFT JOIN run_steps s ON s.run_id = r.id
         ${whereSql}
         GROUP BY r.id
         ORDER BY r.started_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
    );
    return rows.map(normalizeRunRow);
}

export async function getRunById(runId, orgScope = []) {
    const params = [runId];
    let orgFilter = '';
    if (Array.isArray(orgScope) && orgScope.length > 0) {
        params.push(orgScope);
        orgFilter = ` AND (r.org_id = ANY($2::bigint[]) OR r.org_id IS NULL)`;
    }
    const { rows } = await safeQuery(
        `SELECT r.* FROM runs r WHERE r.id = $1 ${orgFilter} LIMIT 1`,
        params
    );
    if (!rows.length) return null;

    const run = rows[0];
    const [stepsRes, eventsRes] = await Promise.all([
        safeQuery(
            `SELECT step_id AS id, label, status, duration_ms AS duration, error_text AS error
             FROM run_steps WHERE run_id = $1 ORDER BY seq`,
            [runId]
        ),
        safeQuery(
            `SELECT ts AS timestamp, type, message
             FROM run_events WHERE run_id = $1 ORDER BY ts`,
            [runId]
        ),
    ]);

    return {
        ...normalizeRunRow(run),
        steps: stepsRes.rows,
        events: eventsRes.rows,
    };
}

export async function deleteRun(runId, orgScope = []) {
    const values = [runId];
    let filter = '';
    if (Array.isArray(orgScope) && orgScope.length > 0) {
        values.push(orgScope);
        filter = ` AND (org_id = ANY($2::bigint[]) OR org_id IS NULL)`;
    }
    const { rowCount } = await safeQuery(`DELETE FROM runs WHERE id = $1${filter}`, values);
    return rowCount;
}

export async function deleteAllRuns(orgScope = []) {
    if (Array.isArray(orgScope) && orgScope.length > 0) {
        const { rowCount } = await safeQuery(
            `DELETE FROM runs WHERE org_id = ANY($1::bigint[]) OR org_id IS NULL`,
            [orgScope]
        );
        return rowCount;
    }
    const { rowCount } = await safeQuery(`DELETE FROM runs`);
    return rowCount;
}
