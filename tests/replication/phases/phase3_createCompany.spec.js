import { test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { login } from '../../helpers/login.js';
import { createCompany } from '../../helpers/createCompany.js';
import { activateFeaturesAPI } from '../../helpers/activateFeaturesAPI.js';

test('Phase 3: Create Company + Features', async ({ page }) => {
    const dataFile = process.env.REPLICATION_DATA_FILE;
    if (!dataFile) throw new Error('REPLICATION_DATA_FILE env variable is not set');

    const rawData = JSON.parse(readFileSync(dataFile, 'utf-8'));
    const overrides = rawData.overrides || {};
    const BASE_URL = process.env.STAGE_BASE_URL;
    const newOrgId = rawData.result?.newOrgId;

    if (!newOrgId) throw new Error('No newOrgId found in result — run Phase 1 first');
    if (!rawData.company) {
        console.log('[COMPANY] No company data provided, skipping.');
        return;
    }

    await login(page, BASE_URL, process.env.STAGE_SUPERADMIN_EMAIL, process.env.STAGE_SUPERADMIN_PASSWORD);

    const companyName = overrides.newCompanyName || `${rawData.company.name} (Copy ${Date.now()})`;
    const locations = rawData.locations || [];

    const newCompanyId = await createCompany(page, BASE_URL, rawData.company, companyName, newOrgId, locations);

    rawData.result = rawData.result || {};
    rawData.result.companyName = companyName;
    rawData.result.orgId = String(newOrgId);
    if (newCompanyId) rawData.result.newCompanyId = newCompanyId;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    if (newCompanyId && rawData.company?.id) {
        console.log(`[FEATURE] Activating features: source=${rawData.company.id} target=${newCompanyId}`);
        const featureResult = await activateFeaturesAPI(
            page,
            rawData.company.id,
            newCompanyId,
            BASE_URL,
            rawData.activeFeatures
        );
        rawData.result.featuresActivated = featureResult.activated;
        rawData.result.featuresFailed = featureResult.failed;
        writeFileSync(dataFile, JSON.stringify(rawData, null, 2));
    }

    console.log(`[COMPANY] Company "${companyName}" created (ID: ${newCompanyId || 'unknown'})`);
});
