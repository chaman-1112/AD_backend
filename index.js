import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dataRouter from './routes/data.js';
import replicateRouter from './routes/replicate.js';
import authRouter from './routes/auth.js';
import historyRouter from './routes/history.js';
import pool, { ensureAppSchema, switchDbConfig } from './db.js';
import { getActiveEnv, getEnvConfig, initEnvManager, switchActiveEnv } from './envManager.js';
import { loadUserOrgScope, requireAuth } from './middleware/auth.js';
import { validateSwitchEnvPayload } from './middleware/validate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ENV_PATH = resolve(__dirname, '.env');
dotenv.config({ path: ENV_PATH });
initEnvManager(ENV_PATH);

const app = express();
const PORT = process.env.API_PORT || 4001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
}));
app.use(express.json({ limit: '25mb' }));
app.use(session({
    name: 'sid',
    secret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12,
    },
}));

// --- API Routes ---
app.use('/api/auth', authRouter);
app.use('/api/data', requireAuth, loadUserOrgScope, dataRouter);
app.use('/api/replicate', requireAuth, loadUserOrgScope, replicateRouter);
app.use('/api/history', requireAuth, loadUserOrgScope, historyRouter);

// --- Health check ---
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ status: 'ok', db: 'connected', time: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
    }
});

app.get('/api/whoami', (req, res) => {
    const user = req.session?.user;
    if (!user) {
        return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    res.json({ email: user.email, name: user.name, role: user.role });
});

app.get('/api/current-env', requireAuth, (req, res) => {
    try {
        const env = getActiveEnv();
        res.json({ env, email: getEnvConfig(env).STAGE_SUPERADMIN_EMAIL || '' });
    } catch (err) {
        res.status(500).json({ code: 'ENV_READ_ERROR', message: err.message });
    }
});

app.get('/api/current-env-public', (req, res) => {
    try {
        const env = getActiveEnv();
        res.json({ env });
    } catch (err) {
        res.status(500).json({ code: 'ENV_READ_ERROR', message: err.message });
    }
});

app.post('/api/switch-env', validateSwitchEnvPayload, async (req, res) => {
    const { env } = req.body || {};
    try {
        const currentEnv = getActiveEnv();
        if (currentEnv === env) {
            return res.json({ ok: true, restarting: false, message: `Already on ${env}` });
        }

        switchActiveEnv(env);
        await switchDbConfig(getEnvConfig(env));
        await ensureAppSchema();
        if (req.session?.user) {
            req.session.destroy(() => {});
        }
        return res.json({ ok: true, restarting: false, env });
    } catch (err) {
        return res.status(500).json({ code: 'ENV_SWITCH_ERROR', message: err.message });
    }
});

async function startServer() {
    await switchDbConfig(getEnvConfig(getActiveEnv()));
    await ensureAppSchema();
    app.listen(PORT, () => {
        console.log(`\n  Replication Tool API running at http://localhost:${PORT}`);
        console.log(`  Health check: http://localhost:${PORT}/api/health\n`);
    });
}

startServer().catch((err) => {
    console.error('Failed to start API server:', err.message);
    process.exit(1);
});
