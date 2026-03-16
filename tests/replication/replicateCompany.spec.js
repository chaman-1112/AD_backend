import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';

import { login } from '../helpers/login.js';
import { createCompany } from '../helpers/createCompany.js';
import { activateFeaturesAPI } from '../helpers/activateFeaturesAPI.js';

/**
 * Standalone Company Replication — Login + Create Company + Feature Switches
 */
test('Replicate Company', async ({ page }) => {
    const dataFile = process.env.REPLICATION_DATA_FILE;
    if (!dataFile) throw new Error('REPLICATION_DATA_FILE env variable is not set');

    const rawData = JSON.parse(readFileSync(dataFile, 'utf-8'));

    if (!rawData.company) {
        console.log('[COMPANY] No company data provided, skipping.');
        return;
    }

    const orgId = process.env.ORG_ID
        || rawData.overrides?.orgId
        || rawData.result?.newOrgId
        || null;

    if (!orgId) {
        throw new Error(
            'Org ID not found. Provide via ORG_ID env, overrides.orgId, or run org replication first.'
        );
    }

    const companyName = rawData.overrides?.newCompanyName
        || `${rawData.company.name} (Copy ${Date.now()})`;

    const BASE_URL = process.env.STAGE_BASE_URL;

    // 1. Login
    await login(page, BASE_URL, process.env.STAGE_SUPERADMIN_EMAIL, process.env.STAGE_SUPERADMIN_PASSWORD);

    // 2. Create Company (pass locations from source company)
    const locations = rawData.locations || [];
    const newCompanyId = await createCompany(page, BASE_URL, rawData.company, companyName, orgId, locations);

    // 3. Save result
    rawData.result = rawData.result || {};
    rawData.result.companyName = companyName;
    rawData.result.orgId = String(orgId);
    if (newCompanyId) rawData.result.newCompanyId = newCompanyId;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    // 4. Activate Feature Switches using API
    if (newCompanyId && rawData.company && rawData.company.id) {
        const sourceCompanyId = rawData.company.id;
        console.log(`[FEATURE] Using API-based feature activation`);
        console.log(`[FEATURE] Source Company ID: ${sourceCompanyId}`);
        console.log(`[FEATURE] Target Company ID: ${newCompanyId}`);
        
        const featureResult = await activateFeaturesAPI(
            page,
            sourceCompanyId,
            newCompanyId,
            BASE_URL,
            rawData.activeFeatures
        );
        
        rawData.result.featuresActivated = featureResult.activated;
        rawData.result.featuresFailed = featureResult.failed;
        writeFileSync(dataFile, JSON.stringify(rawData, null, 2));
    } else {
        console.log('[FEATURE] Could not find source or target company ID, skipping feature switches.');
    }

    console.log('\n[DONE] Company replication complete!');
    console.log(`[DONE] Org ID: ${orgId}`);
    console.log(`[DONE] Company: "${companyName}"`);
    if (newCompanyId) console.log(`[DONE] Company ID: ${newCompanyId}`);
});
