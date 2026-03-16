import { test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { login } from '../../helpers/login.js';
import { getCsrfToken } from '../../helpers/getCsrfToken.js';
import { postCustomizations } from '../../helpers/postCustomizations.js';
import { postGlobal } from '../../helpers/postGlobal.js';
import { postCustomTexts } from '../../helpers/postCustomTexts.js';
import { postJsonNavigationMenu } from '../../helpers/postJsonNavigationMenu.js';

test('Phase 4: Copy Customizations via API', async ({ page }) => {
    const dataFile = process.env.REPLICATION_DATA_FILE;
    if (!dataFile) throw new Error('REPLICATION_DATA_FILE env variable is not set');

    const rawData = JSON.parse(readFileSync(dataFile, 'utf-8'));
    const BASE_URL = process.env.STAGE_BASE_URL;
    const newOrgId = rawData.result?.newOrgId;

    if (!newOrgId) throw new Error('No newOrgId found in result — run Phase 1 first');

    await login(page, BASE_URL, process.env.STAGE_SUPERADMIN_EMAIL, process.env.STAGE_SUPERADMIN_PASSWORD);

    let csrf = await getCsrfToken(page, BASE_URL);
    if (!csrf) {
        console.error('[CSRF] Could not obtain CSRF token — skipping all API POST steps');
        return;
    }

    const custResult = await postCustomizations(page, BASE_URL, csrf, newOrgId, rawData.customizations);
    csrf = custResult.csrf;
    rawData.result = rawData.result || {};
    rawData.result.customizations = custResult.results;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    csrf = await postJsonNavigationMenu(page, BASE_URL, csrf, newOrgId, rawData.jsonNavMenu);
    await postGlobal(page, BASE_URL, csrf, newOrgId, rawData.globals);
    const ctResults = await postCustomTexts(page, BASE_URL, csrf, newOrgId, rawData.customTexts);

    rawData.result.customTexts = ctResults;
    rawData.result.customizationsDone = true;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    console.log('[CUSTOMIZATIONS] All customizations, global, texts, and nav menu copied.');
});
