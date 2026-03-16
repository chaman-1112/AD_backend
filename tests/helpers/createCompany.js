import { parseCompanyData } from '../utils/parseCompanyData.js';
import { findCompanyIdByName } from '../utils/db.js';

/**
 * Create a new company via the superadmin form and look up its ID from DB.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {object} rawCompany - raw company row from DB
 * @param {string} companyName
 * @param {string} orgId
 * @param {Array} [locations] - location rows from DB (vendor_id = source company id)
 * @returns {Promise<string|null>} newCompanyId
 */
export async function createCompany(page, baseUrl, rawCompany, companyName, orgId, locations = []) {
    const companyData = parseCompanyData(rawCompany);
    companyName = companyName.trim();

    console.log(`\n[COMPANY] Creating company "${companyName}" under org #${orgId}...`);

    // Navigate to New Company
    await page.getByRole('link', { name: 'Companies & Groups' }).hover();
    await page.getByRole('link', { name: 'Companies', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'New Company' }).click();
    await page.waitForLoadState('networkidle');

    console.log('[COMPANY] Filling company form...');


    const orgIdStr = String(orgId);


    // Custom Menu
    if (companyData.allowCustomMenu === 'true') {
        await page.getByLabel('Allow custom menu?').selectOption('true');
        const menuTypes = companyData.allowCustomMenuTypes;
        if (menuTypes.diamond) await page.getByRole('group', { name: 'Allow custom menu for' }).getByLabel('diamonds?', { exact: true }).selectOption(menuTypes.diamond);
        if (menuTypes.gemstone) await page.getByRole('group', { name: 'Allow custom menu for' }).getByLabel('gemstones?').selectOption(menuTypes.gemstone);
        if (menuTypes.jewelry) await page.getByRole('group', { name: 'Allow custom menu for' }).getByLabel('jewelry?').selectOption(menuTypes.jewelry);
        if (menuTypes.lab_grown_diamond) await page.getByRole('group', { name: 'Allow custom menu for' }).getByLabel('lab grown diamonds?').selectOption(menuTypes.lab_grown_diamond);
    }

    // Custom Theme
    if (companyData.allowCustomTheme === 'true') {
        await page.getByLabel('Allow custom theme?').selectOption('true');
        const themeTypes = companyData.allowCustomThemeTypes;
        if (themeTypes.diamond) await page.getByRole('group', { name: 'Allow custom theme for' }).getByLabel('diamonds?', { exact: true }).selectOption(themeTypes.diamond);
        if (themeTypes.gemstone) await page.getByRole('group', { name: 'Allow custom theme for' }).getByLabel('gemstones?').selectOption(themeTypes.gemstone);
        if (themeTypes.jewelry) await page.getByRole('group', { name: 'Allow custom theme for' }).getByLabel('jewelry?').selectOption(themeTypes.jewelry);
        if (themeTypes.lab_grown_diamond) await page.getByRole('group', { name: 'Allow custom theme for' }).getByLabel('lab grown diamonds?').selectOption(themeTypes.lab_grown_diamond);
    }

    const companyTypeStr = String(companyData.companyType || '');
    const allowDiamondsStr = String(companyData.allowDiamonds ?? 'false');
    const allowGemstonesStr = String(companyData.allowGemstones ?? 'false');
    const allowJewelryStr = String(companyData.allowJewelry ?? 'false');
    const allowLabGrownStr = String(companyData.allowLabGrownDiamonds ?? 'false');

    await page.getByRole('textbox', { name: 'Name*', exact: true }).fill(companyName);

    // Select org (reloads form)
    await page.locator('#company_organization_id').selectOption(orgIdStr);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Re-fill name after org reload
    await page.getByRole('textbox', { name: 'Name*', exact: true }).fill(companyName);
    await page.getByLabel('Company Type*').selectOption(companyTypeStr);

    // Stock Permissions
    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow diamonds?')
        .selectOption(allowDiamondsStr);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow gemstones?')
        .selectOption(allowGemstonesStr);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow jewelry?')
        .selectOption(allowJewelryStr);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow lab grown diamonds?')
        .selectOption(allowLabGrownStr);

    // Location — use actual location from source company if available
    const sourceLocation = locations.length > 0 ? locations[0] : null;
    const locationName = sourceLocation?.location_name || `${companyData.country}_${Date.now()}`;
    const locationCountry = sourceLocation?.country || companyData.country;
    const locationEmail = sourceLocation?.contact_email || companyData.requestEmailAddress || 'abc1234567890@gmail.com';

    console.log(`[COMPANY] Location: "${locationName}" (country: ${locationCountry})`);

    await page.getByRole('textbox', { name: 'Location name*' }).fill(locationName);
    await page.getByLabel('Country*').selectOption(locationCountry);
    await page.getByRole('textbox', { name: 'Contact email' }).fill(locationEmail);

    await page.getByRole('link', { name: 'Add to another group' }).click();
    await page.getByLabel('Group', { exact: true }).selectOption('1604');
    // Submit
    console.log('[COMPANY] Submitting company...');
    await page.getByRole('button', { name: 'Create Company' }).click();
    await page.waitForLoadState('networkidle');

    console.log(`[COMPANY] Company "${companyName}" created!`);

    // Poll DB for the new company ID (retries with delay for write lag)
    console.log(`[DB] Looking up company "${companyName}" in org #${orgId}...`);
    const newCompanyId = await findCompanyIdByName(companyName, orgId);

    if (!newCompanyId) {
        throw new Error(`Could not find company "${companyName}" in org #${orgId} after creation`);
    }
    console.log(`[DB] New company ID: ${newCompanyId}`);
    return newCompanyId;
}
