import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { dbQuery } from '../db.js';
import { validateLoginPayload } from '../middleware/validate.js';
import { getActiveEnv } from '../envManager.js';
import { requireAuth, loadUserOrgScope } from '../middleware/auth.js';

const router = Router();
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

router.post('/login', validateLoginPayload, async (req, res) => {
    const { email, password } = req.body;
    const key = email.toLowerCase();
    const now = Date.now();
    const state = loginAttempts.get(key);
    if (state?.lockedUntil && state.lockedUntil > now) {
        return res.status(429).json({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many login attempts. Try again later.' });
    }
    try {
        const { rows } = await dbQuery(
            `SELECT id, email, encrypted_password FROM admin_users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
            [email]
        );
        if (!rows.length) {
            return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.encrypted_password || '');
        if (!valid) {
            const nextCount = (state?.count || 0) + 1;
            loginAttempts.set(key, {
                count: nextCount,
                lockedUntil: nextCount >= MAX_ATTEMPTS ? now + LOCK_MS : null,
            });
            return res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
        }
        loginAttempts.delete(key);

        const role = 'admin';
        const displayName = user.email?.split('@')[0] || 'User';
        await dbQuery(
            `INSERT INTO automation_users (admin_user_id, email, display_name, role, active_env, last_login_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             ON CONFLICT (admin_user_id) DO UPDATE SET
                email = EXCLUDED.email,
                display_name = EXCLUDED.display_name,
                role = EXCLUDED.role,
                active_env = EXCLUDED.active_env,
                last_login_at = NOW(),
                updated_at = NOW()`,
            [Number(user.id), user.email, displayName, role, getActiveEnv()]
        );

        req.session.user = {
            id: Number(user.id),
            email: user.email,
            name: displayName,
            role,
        };
        req.session.save(() => {});
        return res.json({ ok: true, user: req.session.user });
    } catch (err) {
        return res.status(500).json({ code: 'AUTH_ERROR', message: 'Unable to login' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('sid');
        res.json({ ok: true });
    });
});

router.get('/me', requireAuth, loadUserOrgScope, (req, res) => {
    res.json({
        ok: true,
        user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            role: req.user.role,
            orgScope: req.user.orgScope || [],
        },
    });
});

export default router;
