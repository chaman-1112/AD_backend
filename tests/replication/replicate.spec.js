import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';

import { login } from '../helpers/login.js';
import { createOrg } from '../helpers/createOrg.js';
import { applyOrgSettings } from '../helpers/applyOrgSettings.js';
import { createCompany } from '../helpers/createCompany.js';
import { activateFeaturesAPI } from '../helpers/activateFeaturesAPI.js';
import { getCsrfToken } from '../helpers/getCsrfToken.js';
import { postCustomizations } from '../helpers/postCustomizations.js';
import { postGlobal } from '../helpers/postGlobal.js';
import { postCustomTexts } from '../helpers/postCustomTexts.js';
import { postJsonNavigationMenu } from '../helpers/postJsonNavigationMenu.js';

/**
 * Unified Replication Script — Single Login, Full Flow (Phase 1)
 *
 * Steps:
 *   1. Login (once, vdborg001 creds)
 *   2. Create Organization + Apply Settings
 *   3. Create Company + Activate Feature Switches
 *   4. Create Customizations, Global, Custom Texts, JsonNavMenu via API POST
 *
 * Phase 2 (Custom Search Menus + White Label) runs post-spec via backend
 * using vdbdatamappings creds — see backend/routes/replicate.js
 */
test('Full Replication', async ({ page }) => {
    const dataFile = process.env.REPLICATION_DATA_FILE;
    if (!dataFile) throw new Error('REPLICATION_DATA_FILE env variable is not set');

    const rawData = JSON.parse(readFileSync(dataFile, 'utf-8'));
    const overrides = rawData.overrides || {};
    const BASE_URL = process.env.STAGE_BASE_URL;

    // ── 1. LOGIN ──
    await login(page, BASE_URL, process.env.STAGE_SUPERADMIN_EMAIL, process.env.STAGE_SUPERADMIN_PASSWORD);

    // ── 2. CREATE ORGANIZATION ──
    let newOrgId = null;

    if (rawData.org) {
        const orgName = overrides.newOrgName || `Copy of ${rawData.org.name}`;
        const domainUrl = overrides.newDomainUrl || `copy-${rawData.org.domain_url}-${Date.now()}`;

        newOrgId = await createOrg(page, BASE_URL, rawData.org, orgName, domainUrl);

        rawData.result = rawData.result || {};
        rawData.result.orgName = orgName;
        rawData.result.orgId = newOrgId;
        rawData.result.newOrgId = newOrgId;
        writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

        // ── 3. APPLY ORG SETTINGS ──
        await applyOrgSettings(page, BASE_URL, newOrgId, rawData.orgSettings);

        console.log(`[ORG] Organization "${orgName}" created and configured (ID: ${newOrgId})`);
    }

    // Fallback org ID
    if (!newOrgId) {
        newOrgId = overrides.orgId || rawData.result?.newOrgId || rawData.result?.orgId;
    }
    if (!newOrgId) {
        throw new Error('No org ID available. Either provide org data or set overrides.orgId');
    }

    // ── 4. CREATE COMPANY + FEATURE SWITCHES ──
    let newCompanyId = null;

    if (rawData.company) {
        const companyName = overrides.newCompanyName || `${rawData.company.name} (Copy ${Date.now()})`;
        const locations = rawData.locations || [];

        newCompanyId = await createCompany(page, BASE_URL, rawData.company, companyName, newOrgId, locations);

        rawData.result = rawData.result || {};
        rawData.result.companyName = companyName;
        rawData.result.orgId = String(newOrgId);
        writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

        if (newCompanyId) {
            rawData.result.newCompanyId = newCompanyId;
            writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

            // Activate features using API instead of Playwright
            if (rawData.company && rawData.company.id) {
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
            }
        }
    }

    // ── 5. CSRF TOKEN + API POST STEPS ──
    let csrf = await getCsrfToken(page, BASE_URL);

    if (!csrf) {
        console.error('[CSRF] Could not obtain CSRF token — skipping all API POST steps');
    } else {
        // Customizations
        const custResult = await postCustomizations(page, BASE_URL, csrf, newOrgId, rawData.customizations);
        csrf = custResult.csrf;

        rawData.result = rawData.result || {};
        rawData.result.customizations = custResult.results;
        writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

        // JsonNavigationMenu
        csrf = await postJsonNavigationMenu(page, BASE_URL, csrf, newOrgId, rawData.jsonNavMenu);

        // Global
        await postGlobal(page, BASE_URL, csrf, newOrgId, rawData.globals);

        // Custom Texts
        const ctResults = await postCustomTexts(page, BASE_URL, csrf, newOrgId, rawData.customTexts);

        rawData.result.customTexts = ctResults;
        writeFileSync(dataFile, JSON.stringify(rawData, null, 2));
    }

    // ── 6. SAVE FINAL RESULTS ──
    rawData.result = rawData.result || {};
    rawData.result.newOrgId = newOrgId;
    if (newCompanyId) rawData.result.newCompanyId = newCompanyId;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    console.log('\n[DONE] ========== REPLICATION COMPLETE ==========');
    console.log(`[DONE] Org ID: ${newOrgId}`);
    if (newCompanyId) console.log(`[DONE] Company ID: ${newCompanyId}`);
    if (rawData.customizations?.length > 0) console.log(`[DONE] Customizations: ${rawData.customizations.length}`);
    if (rawData.jsonNavMenu) console.log(`[DONE] JsonNavigationMenu: created`);
    if (rawData.globals?.length > 0) console.log(`[DONE] Global: created`);
    if (rawData.customTexts?.length > 0) console.log(`[DONE] Custom Texts: ${rawData.customTexts.length}`);
    console.log('[DONE] ============================================');
});
