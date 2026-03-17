import { Router } from 'express';
import { validateHistoryQuery } from '../middleware/validate.js';
import { getRunById, listRuns } from '../services/runStore.js';

const router = Router();

router.get('/', validateHistoryQuery, async (req, res) => {
    try {
        const rows = await listRuns({
            status: req.query.status || '',
            mode: req.query.mode || '',
            q: req.query.q || '',
            limit: req.query.limit,
            offset: req.query.offset,
        });
        res.json(rows);
    } catch (err) {
        res.status(500).json({ code: 'HISTORY_LIST_ERROR', message: 'Failed to fetch history' });
    }
});

router.get('/:runId', async (req, res) => {
    try {
        const run = await getRunById(req.params.runId);
        if (!run) return res.status(404).json({ code: 'NOT_FOUND', message: 'Run not found' });
        return res.json(run);
    } catch (err) {
        return res.status(500).json({ code: 'HISTORY_DETAIL_ERROR', message: 'Failed to fetch run' });
    }
});

export default router;
