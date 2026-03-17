function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

export function validateLoginPayload(req, res, next) {
    const body = req.body;
    if (!isObject(body)) {
        return res.status(400).json({ code: 'INVALID_BODY', message: 'Request body must be an object' });
    }
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
        return res.status(400).json({ code: 'INVALID_CREDENTIALS_PAYLOAD', message: 'email and password are required' });
    }
    req.body.email = email;
    req.body.password = password;
    return next();
}

export function validateHistoryQuery(req, res, next) {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    const limit = limitRaw === undefined ? 50 : Number(limitRaw);
    const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return res.status(400).json({ code: 'INVALID_LIMIT', message: 'limit must be between 1 and 200' });
    }
    if (!Number.isInteger(offset) || offset < 0) {
        return res.status(400).json({ code: 'INVALID_OFFSET', message: 'offset must be >= 0' });
    }
    req.query.limit = limit;
    req.query.offset = offset;
    return next();
}
