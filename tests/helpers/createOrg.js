import { parseOrgData } from '../utils/parseOrgData.js';
import { findOrgIdByName } from '../utils/db.js';

/**
 * Create a new organization via the superadmin form.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {object} rawOrg   - raw org row from DB
 * @param {string} orgName  - name for the new org
 * @param {string} domainUrl
 * @returns {Promise<string>} newOrgId
 */
export async function createOrg(page, baseUrl, rawOrg, orgName, domainUrl) {
    const orgData = parseOrgData({ query: [rawOrg] });

    console.log(`\n[ORG] Replicating org "${orgData.name}" as "${orgName}"`);
    console.log('[ORG] Navigating to New Organization...');
    await page.getByRole('link', { name: 'Organizations' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'New Organization' }).click();
    await page.waitForLoadState('networkidle');

    console.log('[ORG] Filling organization form...');

    // Basic Info
    await page.getByRole('textbox', { name: 'Name*' }).fill(orgName);
    await page.getByRole('textbox', { name: 'Domain url*' }).fill(domainUrl);
    if (orgData.status) await page.getByLabel('Status', { exact: true }).selectOption(orgData.status);

    // // App Identifiers
    if (orgData.androidAppIdentifier) await page.getByRole('textbox', { name: 'Android app identifier' }).fill(orgData.androidAppIdentifier);
    if (orgData.iosAppIdentifier) await page.getByRole('textbox', { name: 'iOS app identifier' }).fill(orgData.iosAppIdentifier);

    // Deep Link Settings
    if (orgData.apn) await page.getByRole('textbox', { name: 'Apn*' }).fill(orgData.apn);
    if (orgData.ibi) await page.getByRole('textbox', { name: 'Ibi*' }).fill(orgData.ibi);
    if (orgData.isi) await page.getByRole('textbox', { name: 'Isi*' }).fill(orgData.isi);
    if (orgData.loginDeeplink) await page.getByRole('textbox', { name: 'Login deeplink*' }).fill(orgData.loginDeeplink);
    if (orgData.baseUrl) await page.getByRole('textbox', { name: 'Base url*' }).fill(orgData.baseUrl);
    if (orgData.linkUrl) await page.getByRole('textbox', { name: 'Link url*' }).fill(orgData.linkUrl);

    // Iframe & Web Status
    if (orgData.iframeStatus) await page.getByRole('checkbox', { name: 'Iframe status' }).check();
    if (orgData.webStatus) await page.getByRole('checkbox', { name: 'Web status' }).check();

    // Custom Header
    if (orgData.customHeaderHtml) await page.getByRole('textbox', { name: 'Custom header html' }).fill(orgData.customHeaderHtml);

    // Emails & Phone (JSON fields)
    if (orgData.emails && Object.keys(orgData.emails).length) await page.getByRole('textbox', { name: 'Emails ( Enter details in' }).fill(JSON.stringify(orgData.emails));
    if (orgData.phone && Object.keys(orgData.phone).length) await page.getByRole('textbox', { name: 'Phone (Enter details in JSON' }).fill(JSON.stringify(orgData.phone));

    // URLs
    if (orgData.faviconUrl) await page.getByRole('textbox', { name: 'Favicon url' }).fill(orgData.faviconUrl);
    if (orgData.externalLandingPageUrl) await page.getByRole('textbox', { name: 'External landing page url', exact: true }).fill(orgData.externalLandingPageUrl);
    if (orgData.internalLandingPageUrl) await page.getByRole('textbox', { name: 'Internal landing page url', exact: true }).fill(orgData.internalLandingPageUrl);
    if (orgData.internalLandingPageUrlV3) await page.getByRole('textbox', { name: 'Internal landing page url v3' }).fill(orgData.internalLandingPageUrlV3);

    // // Stock Item Permissions
    console.log('[ORG] Setting stock permissions...');
    await page.getByLabel('Allow diamonds?').selectOption(orgData.allowDiamonds);
    await page.getByLabel('Allow gemstones?').selectOption(orgData.allowGemstones);
    await page.getByLabel('Allow jewelry?').selectOption(orgData.allowJewelry);
    await page.getByLabel('Allow lab-grown diamonds?').selectOption(orgData.allowLabGrownDiamonds);


    // View Settings
    await page.getByLabel('diamonds?', { exact: true }).selectOption(orgData.diamondsView);
    await page.getByLabel('gemstones?', { exact: true }).selectOption(orgData.gemstonesView);
    await page.getByLabel('Jewelry?', { exact: true }).selectOption(orgData.jewelryView);

    // Business Plan
    // if (orgData.businessPlan) await page.getByLabel('Business plan').selectOption(orgData.businessPlan);

    // Submit
    console.log('[ORG] Submitting organization...');
    await page.getByRole('button', { name: 'Create Organization' }).click();
    await page.waitForLoadState('networkidle');

    // Find new org ID from DB
    console.log(`[DB] Querying DB for org ID with name "${orgName}"...`);
    const newOrgId = await findOrgIdByName(orgName);

    if (!newOrgId) {
        throw new Error(`Could not find org "${orgName}" in database after creation`);
    }
    console.log(`[DB] Found org ID: ${newOrgId}`);
    console.log(`[ORG] Organization "${orgName}" created (ID: ${newOrgId})`);

    return newOrgId;
}
