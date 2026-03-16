/**
 * Activate feature switches for a company.
 *
 * The page does NOT auto-refresh after clicking "Activate", so we
 * clear the description field and click Filter to force a refresh
 * before moving to the next feature.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} companyId
 * @param {Array} features - array of { feature_id, feature_description }
 */
export async function activateFeatures(page, baseUrl, companyId, features) {
    if (!features || features.length === 0) {
        console.log('[FEATURE] No feature switches to activate — skipping');
        return;
    }

    console.log(`\n[FEATURE] Navigating to company #${companyId} edit page...`);
    await page.goto(`${baseUrl}/superadmin/companies/${companyId}/edit`, {
        waitUntil: 'networkidle',
    });

    await page.getByRole('link', { name: 'Feature Switches' }).click();
    await page.waitForLoadState('networkidle');

    console.log(`[FEATURE] Activating ${features.length} feature switches...`);

    for (const feature of features) {
        const desc = feature.feature_description;

        if (!desc) {
            console.log(`[FEATURE] Skipping feature ID ${feature.feature_id} — no description`);
            continue;
        }

        console.log(`[FEATURE] Activating: "${desc}" (ID: ${feature.feature_id})`);

        // Search for the feature by description
        await page.getByRole('textbox', { name: 'Feature description' }).fill(desc);
        await page.getByRole('button', { name: 'Filter' }).click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(500);

        // Click Activate if visible
        const activateLink = page.getByRole('link', { name: 'Activate' });
        if (await activateLink.isVisible({ timeout: 3000 }).catch(() => false)) {
            await activateLink.click();
            await page.waitForTimeout(500);

            // The page does NOT refresh after Activate — clear the description
            // and click Filter to force a page refresh before the next feature
            await page.getByRole('textbox', { name: 'Feature description' }).fill('');
            await page.getByRole('button', { name: 'Filter' }).click();
            await page.waitForLoadState('networkidle');

            console.log(`[FEATURE] Activated: "${desc}"`);
        } else {
            console.log(`[FEATURE] Already active or not found: "${desc}"`);
        }
    }

    console.log(`[FEATURE] Feature switch activation complete.`);
}
