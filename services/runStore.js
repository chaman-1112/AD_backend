import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORE_PATH = resolve(__dirname, '../tmp/runs.txt');
let storeQueue = Promise.resolve();

function toStatus(status) {
    return status || 'pending';
}

async function readStore() {
    try {
        const raw = await readFile(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        if (err?.code === 'ENOENT') return [];
        if (err instanceof SyntaxError) {
            console.warn('Invalid runs.txt JSON detected. Resetting in-memory store for this operation.');
            return [];
        }
        throw err;
    }
}

async function writeStore(runs) {
    await mkdir(dirname(STORE_PATH), { recursive: true });
    const tempPath = `${STORE_PATH}.tmp`;
    await writeFile(tempPath, JSON.stringify(runs, null, 2), 'utf-8');
    await rename(tempPath, STORE_PATH);
}

function withStoreMutation(mutator) {
    const next = storeQueue.then(() => mutator());
    // Keep queue alive even after failures so future operations still run.
    storeQueue = next.catch(() => {});
    return next;
}

function normalizeRunRow(row) {
    return {
        id: row.id,
        mode: row.mode,
        label: row.label,
        status: row.status,
        userId: row.userId ?? null,
        orgId: row.orgId ?? null,
        user: row.user ?? null,
        userEmail: row.userEmail ?? null,
        request: row.request || {},
        resultMessage: row.resultMessage || null,
        activeEnv: row.activeEnv || null,
        startedAt: row.startedAt || null,
        endedAt: row.endedAt || null,
        steps: Array.isArray(row.steps) ? row.steps : [],
    };
}

function hasOrgAccess(row, orgScope = []) {
    if (!Array.isArray(orgScope) || orgScope.length === 0) return true;
    return row.orgId == null || orgScope.includes(Number(row.orgId));
}

function ensureRun(runs, runId) {
    let run = runs.find((r) => r.id === runId);
    if (!run) {
        run = {
            id: runId,
            mode: 'unknown',
            label: runId,
            status: 'running',
            userId: null,
            orgId: null,
            user: null,
            userEmail: null,
            request: {},
            resultMessage: null,
            activeEnv: null,
            startedAt: new Date().toISOString(),
            endedAt: null,
            steps: [],
            events: [],
        };
        runs.push(run);
    }
    if (!Array.isArray(run.steps)) run.steps = [];
    if (!Array.isArray(run.events)) run.events = [];
    return run;
}

export async function createRun(payload) {
    return withStoreMutation(async () => {
        const runs = await readStore();
        const run = ensureRun(runs, payload.id);
        run.mode = payload.mode;
        run.label = payload.label;
        run.status = payload.status || 'running';
        run.userId = payload.userId ?? null;
        run.orgId = payload.orgId ?? null;
        run.user = payload.userName ?? null;
        run.userEmail = payload.userEmail ?? null;
        run.request = payload.request || {};
        run.activeEnv = payload.activeEnv ?? null;
        run.startedAt = run.startedAt || new Date().toISOString();
        await writeStore(runs);
    });
}

export async function upsertStep(runId, step, seq = 0) {
    return withStoreMutation(async () => {
        const runs = await readStore();
        const run = ensureRun(runs, runId);
        const stepId = step.stepId || step.id;
        if (!stepId) return;

        const nextStep = {
            id: stepId,
            label: step.label || null,
            status: toStatus(step.status),
            duration: step.duration ?? step.duration_ms ?? null,
            error: step.error || null,
            seq,
        };
        const idx = run.steps.findIndex((s) => s.id === stepId);
        if (idx >= 0) run.steps[idx] = { ...run.steps[idx], ...nextStep };
        else run.steps.push(nextStep);
        run.steps.sort((a, b) => (a.seq || 0) - (b.seq || 0));

        await writeStore(runs);
    });
}

export async function addEvent(runId, event) {
    return withStoreMutation(async () => {
        const runs = await readStore();
        const run = ensureRun(runs, runId);
        run.events.push({
            timestamp: new Date().toISOString(),
            type: event.type || 'log',
            message: String(event.message || ''),
        });
        await writeStore(runs);
    });
}

export async function finalizeRun(runId, { status, resultMessage = null } = {}) {
    return withStoreMutation(async () => {
        const runs = await readStore();
        const run = ensureRun(runs, runId);
        run.status = status || run.status;
        run.resultMessage = resultMessage;
        run.endedAt = new Date().toISOString();
        await writeStore(runs);
    });
}

export async function listRuns({ status, mode, q, limit = 50, offset = 0, orgScope = [] }) {
    const rows = await readStore();
    const needle = String(q || '').toLowerCase();
    const filtered = rows
        .filter((r) => !status || r.status === status)
        .filter((r) => !mode || r.mode === mode)
        .filter((r) => !needle || [r.label, r.user, r.userEmail].some((v) => String(v || '').toLowerCase().includes(needle)))
        .filter((r) => hasOrgAccess(r, orgScope))
        .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());

    return filtered
        .slice(offset, offset + limit)
        .map(normalizeRunRow);
}

export async function getRunById(runId, orgScope = []) {
    const rows = await readStore();
    const run = rows.find((r) => r.id === runId);
    if (!run || !hasOrgAccess(run, orgScope)) return null;

    return {
        ...normalizeRunRow(run),
        steps: Array.isArray(run.steps)
            ? run.steps
                .slice()
                .sort((a, b) => (a.seq || 0) - (b.seq || 0))
                .map((s) => ({
                    id: s.id,
                    label: s.label || null,
                    status: s.status || 'pending',
                    duration: s.duration ?? null,
                    error: s.error || null,
                }))
            : [],
        events: Array.isArray(run.events) ? run.events : [],
    };
}

export async function deleteRun(runId, orgScope = []) {
    return withStoreMutation(async () => {
        const rows = await readStore();
        const next = rows.filter((r) => !(r.id === runId && hasOrgAccess(r, orgScope)));
        const deleted = rows.length - next.length;
        if (deleted > 0) await writeStore(next);
        return deleted;
    });
}

export async function deleteAllRuns(orgScope = []) {
    return withStoreMutation(async () => {
        const rows = await readStore();
        let next = [];
        if (Array.isArray(orgScope) && orgScope.length > 0) {
            next = rows.filter((r) => !hasOrgAccess(r, orgScope));
        }
        const deleted = rows.length - next.length;
        if (deleted > 0) await writeStore(next);
        return deleted;
    });
}
