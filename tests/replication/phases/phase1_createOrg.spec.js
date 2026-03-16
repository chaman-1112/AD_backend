import { test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { login } from '../../helpers/login.js';
import { createOrg } from '../../helpers/createOrg.js';

test('Phase 1: Create Organization', async ({ page }) => {
    const dataFile = process.env.REPLICATION_DATA_FILE;
    if (!dataFile) throw new Error('REPLICATION_DATA_FILE env variable is not set');

    const rawData = JSON.parse(readFileSync(dataFile, 'utf-8'));
    const overrides = rawData.overrides || {};
    const BASE_URL = process.env.STAGE_BASE_URL;

    if (!rawData.org) throw new Error('No org data provided');

    await login(page, BASE_URL, process.env.STAGE_SUPERADMIN_EMAIL, process.env.STAGE_SUPERADMIN_PASSWORD);

    const orgName = overrides.newOrgName || `Copy of ${rawData.org.name}`;
    const domainUrl = overrides.newDomainUrl || `copy-${rawData.org.domain_url}-${Date.now()}`;

    const newOrgId = await createOrg(page, BASE_URL, rawData.org, orgName, domainUrl);

    rawData.result = rawData.result || {};
    rawData.result.orgName = orgName;
    rawData.result.orgId = newOrgId;
    rawData.result.newOrgId = newOrgId;
    writeFileSync(dataFile, JSON.stringify(rawData, null, 2));

    console.log(`[ORG] Organization "${orgName}" created (ID: ${newOrgId})`);
});
