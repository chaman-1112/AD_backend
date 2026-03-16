import { test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { login } from '../../helpers/login.js';
import { applyOrgSettings } from '../../helpers/applyOrgSettings.js';

test('Phase 2: Apply Org Settings', async ({ page }) => {
    const dataFile = process.env.REPLICATION_DATA_FILE;
    if (!dataFile) throw new Error('REPLICATION_DATA_FILE env variable is not set');

    const rawData = JSON.parse(readFileSync(dataFile, 'utf-8'));
    const BASE_URL = process.env.STAGE_BASE_URL;
    const newOrgId = rawData.result?.newOrgId;

    if (!newOrgId) throw new Error('No newOrgId found in result — run Phase 1 first');
    if (!rawData.orgSettings || rawData.orgSettings.length === 0) {
        console.log('[SETTINGS] No org settings to apply, skipping.');
        return;
    }

    await login(page, BASE_URL, process.env.STAGE_SUPERADMIN_EMAIL, process.env.STAGE_SUPERADMIN_PASSWORD);
    await applyOrgSettings(page, BASE_URL, newOrgId, rawData.orgSettings);

    rawData.result.settingsApplied = true;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    console.log(`[SETTINGS] Org settings applied to org #${newOrgId}`);
});
