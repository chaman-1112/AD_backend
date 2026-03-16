export function requireAuth(req, res, next) {
    const user = req.session?.user;
    if (!user?.id) {
        return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    req.user = user;
    return next();
}

export function requireRole(roles = []) {
    return (req, res, next) => {
        const role = req.user?.role || 'operator';
        if (!roles.includes(role)) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
        }
        return next();
    };
}

export async function loadUserOrgScope(req, res, next) {
    // Org scope disabled for now; keep middleware shape stable.
    req.user.orgScope = [];
    req.user.orgRoles = {};
    return next();
}

export function resolveRequestOrgId(req) {
    const source = req.body?.orgId
        || req.body?.sourceOrgId
        || req.body?.targetOrgId
        || req.query?.org_id
        || req.query?.orgId
        || req.params?.orgId
        || null;
    const asNum = Number(source);
    return Number.isFinite(asNum) ? asNum : null;
}

export function requireOrgAccess(options = {}) {
    const { allowWhenNoOrg = true } = options;
    return (req, res, next) => {
        const orgId = resolveRequestOrgId(req);
        req.requestOrgId = orgId;

        if (!orgId) {
            if (allowWhenNoOrg) return next();
            return res.status(400).json({ code: 'ORG_REQUIRED', message: 'Organization scope is required' });
        }

        const allowed = Array.isArray(req.user?.orgScope) ? req.user.orgScope : [];
        if (!allowed.length) {
            // Temporary bootstrap behavior for first rollout.
            return next();
        }
        if (!allowed.includes(orgId)) {
            return res.status(403).json({ code: 'ORG_FORBIDDEN', message: 'No access to this organization' });
        }
        return next();
    };
}
