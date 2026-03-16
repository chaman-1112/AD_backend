import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ════════════════════════════════════════════════════════════════
//  ORGANIZATIONS
// ════════════════════════════════════════════════════════════════

// GET /api/data/orgs — List all organizations
router.get('/orgs', async (req, res) => {
    try {
        const orgScope = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        const scopeFilter = orgScope.length ? 'WHERE id = ANY($1::bigint[])' : '';
        const params = orgScope.length ? [orgScope] : [];
        const { rows } = await pool.query(
            `SELECT id, name, domain_url, status
             FROM organizations 
             ${scopeFilter}
             ORDER BY name ASC`
            , params
        );
        res.json(rows);
    } catch (err) {
        console.error('Error fetching organizations:', err.message);
        res.status(500).json({ error: 'Failed to fetch organizations', detail: err.message });
    }
});

// GET /api/data/orgs/search?name=xxx — Find latest org by exact name
router.get('/orgs/search', async (req, res) => {
    try {
        const { name } = req.query;
        if (!name) return res.status(400).json({ error: 'name query param is required' });

        const { rows } = await pool.query(
            `SELECT id, name, domain_url, status, created_at
             FROM organizations 
             WHERE name = $1 
             ORDER BY id DESC 
             LIMIT 1`,
            [name]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error searching organization:', err.message);
        res.status(500).json({ error: 'Failed to search organization', detail: err.message });
    }
});

// GET /api/data/orgs/:id — Full organization details
router.get('/orgs/:id', async (req, res) => {
    try {
        const orgId = Number(req.params.id);
        const orgScope = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        if (orgScope.length && !orgScope.includes(orgId)) {
            return res.status(403).json({ error: 'No access to this organization' });
        }
        const { rows } = await pool.query(
            `SELECT * FROM organizations WHERE id = $1`,
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching organization:', err.message);
        res.status(500).json({ error: 'Failed to fetch organization', detail: err.message });
    }
});

// ════════════════════════════════════════════════════════════════
//  COMPANIES
// ════════════════════════════════════════════════════════════════

// GET /api/data/companies?org_id=X — List companies (optionally by org)
router.get('/companies', async (req, res) => {
    try {
        const { org_id } = req.query;
        const orgScope = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        let query, params;

        if (org_id) {
            const orgIdNum = Number(org_id);
            if (orgScope.length && !orgScope.includes(orgIdNum)) {
                return res.status(403).json({ error: 'No access to this organization' });
            }
            query = `SELECT id, name, company_type, organization_id, country, city
                     FROM companies 
                     WHERE organization_id = $1 
                     ORDER BY name ASC`;
            params = [org_id];
        } else {
            if (orgScope.length) {
                query = `SELECT id, name, company_type, organization_id, country, city
                         FROM companies
                         WHERE organization_id = ANY($1::bigint[])
                         ORDER BY name ASC
                         LIMIT 200`;
                params = [orgScope];
            } else {
                query = `SELECT id, name, company_type, organization_id, country, city
                         FROM companies
                         ORDER BY name ASC
                         LIMIT 200`;
                params = [];
            }
        }

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching companies:', err.message);
        res.status(500).json({ error: 'Failed to fetch companies', detail: err.message });
    }
});

// GET /api/data/companies/search?name=xxx&org_id=xxx — Find latest company by name
router.get('/companies/search', async (req, res) => {
    try {
        const { name, org_id } = req.query;
        if (!name) return res.status(400).json({ error: 'name query param is required' });

        let query, params;
        if (org_id) {
            query = `SELECT id, name, company_type, organization_id, country, city, created_at
                     FROM companies 
                     WHERE name = $1 AND organization_id = $2
                     ORDER BY id DESC 
                     LIMIT 1`;
            params = [name, org_id];
        } else {
            query = `SELECT id, name, company_type, organization_id, country, city, created_at
                     FROM companies 
                     WHERE name = $1 
                     ORDER BY id DESC 
                     LIMIT 1`;
            params = [name];
        }

        const { rows } = await pool.query(query, params);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error searching company:', err.message);
        res.status(500).json({ error: 'Failed to search company', detail: err.message });
    }
});

// GET /api/data/companies/:id/locations — Locations for a company (vendor_id = company id)
router.get('/companies/:id/locations', async (req, res) => {
    try {
        const companyId = req.params.id;
        const orgScope = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        if (orgScope.length) {
            const { rows: cRows } = await pool.query('SELECT organization_id FROM companies WHERE id = $1 LIMIT 1', [companyId]);
            if (!cRows.length || !orgScope.includes(Number(cRows[0].organization_id))) {
                return res.status(403).json({ error: 'No access to this company' });
            }
        }
        const { rows } = await pool.query(
            `SELECT * FROM locations WHERE vendor_id = $1 ORDER BY id`,
            [companyId]
        );
        res.json({ company_id: companyId, locations: rows });
    } catch (err) {
        console.error('Error fetching company locations:', err.message);
        res.status(500).json({ error: 'Failed to fetch company locations', detail: err.message });
    }
});

// GET /api/data/companies/:id/features — Active feature switches for a company
router.get('/companies/:id/features', async (req, res) => {
    try {
        const companyId = req.params.id;
        const orgScope = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        if (orgScope.length) {
            const { rows: cRows } = await pool.query('SELECT organization_id FROM companies WHERE id = $1 LIMIT 1', [companyId]);
            if (!cRows.length || !orgScope.includes(Number(cRows[0].organization_id))) {
                return res.status(403).json({ error: 'No access to this company' });
            }
        }
        const { rows } = await pool.query(
            `SELECT f.id AS feature_id, f.description AS feature_description, s.access
             FROM settings s
             JOIN features f ON f.id = s.feature_id
             WHERE s.settable_type = 'Company'
               AND s.settable_id = $1
               AND s.active = true
             ORDER BY f.id`,
            [companyId]
        );
        res.json({ company_id: companyId, active_features: rows });
    } catch (err) {
        console.error('Error fetching company features:', err.message);
        res.status(500).json({ error: 'Failed to fetch company features', detail: err.message });
    }
});

// GET /api/data/companies/:id — Full company details
router.get('/companies/:id', async (req, res) => {
    try {
        const orgScope = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        const { rows } = await pool.query(
            `SELECT * FROM companies WHERE id = $1`,
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }
        if (orgScope.length && !orgScope.includes(Number(rows[0].organization_id))) {
            return res.status(403).json({ error: 'No access to this company' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching company:', err.message);
        res.status(500).json({ error: 'Failed to fetch company', detail: err.message });
    }
});

// ════════════════════════════════════════════════════════════════
//  VALIDATION
// ════════════════════════════════════════════════════════════════

// GET /api/data/validate/org-name?name=xxx — Check if org name already exists
router.get('/validate/org-name', async (req, res) => {
    try {
        const { name } = req.query;
        if (!name) return res.status(400).json({ error: 'name query param is required' });

        const { rows } = await pool.query(
            `SELECT id, name FROM organizations WHERE LOWER(name) = LOWER($1) LIMIT 1`,
            [name]
        );
        res.json({ exists: rows.length > 0, match: rows[0] || null });
    } catch (err) {
        console.error('Error validating org name:', err.message);
        res.status(500).json({ error: 'Validation failed', detail: err.message });
    }
});

// GET /api/data/validate/company-name?name=xxx&org_id=xxx — Check if company name exists in org
router.get('/validate/company-name', async (req, res) => {
    try {
        const { name, org_id } = req.query;
        if (!name) return res.status(400).json({ error: 'name query param is required' });

        let query, params;
        if (org_id) {
            query = `SELECT id, name FROM companies WHERE LOWER(name) = LOWER($1) AND organization_id = $2 LIMIT 1`;
            params = [name, org_id];
        } else {
            query = `SELECT id, name FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`;
            params = [name];
        }

        const { rows } = await pool.query(query, params);
        res.json({ exists: rows.length > 0, match: rows[0] || null });
    } catch (err) {
        console.error('Error validating company name:', err.message);
        res.status(500).json({ error: 'Validation failed', detail: err.message });
    }
});

export default router;
