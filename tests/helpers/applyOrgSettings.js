/**
 * Apply organization settings (feature checkboxes + access dropdowns)
 * on the org edit page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} orgId
 * @param {Array} orgSettings - array of { feature_id, feature_name, feature_description, access }
 * @returns {Promise<Array>} settingResults
 */
export async function applyOrgSettings(page, baseUrl, orgId, orgSettings) {
    if (!orgSettings || orgSettings.length === 0) {
        console.log('[SETTINGS] No org settings to apply — skipping');
        return [];
    }

    console.log(`\n[SETTINGS] Navigating to org edit page...`);
    await page.goto(`${baseUrl}/superadmin/organizations/${orgId}/edit`, {
        waitUntil: 'networkidle',
    });

    const ACCESS_MAP = { 0: 'access_public', 1: 'access_private', 2: 'both' };
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    console.log(`[SETTINGS] Found ${orgSettings.length} active settings to replicate`);
    const settingResults = [];

    for (const setting of orgSettings) {
        const featureName = setting.feature_name || '';
        const featureDesc = setting.feature_description || '';
        const labelJoined = [featureName, featureDesc].filter(Boolean).join(' ');

        console.log(`\n[SETTINGS] Looking for feature #${setting.feature_id}: "${labelJoined}"`);

        const buildPattern = (text) => {
            const patternStr = escapeRegex(text).replace(/_/g, '[_ ]');
            return new RegExp('^' + patternStr, 'i');
        };

        let checkbox = null;
        let matchedWith = '';

        const strategies = [
            { label: 'name+description', text: labelJoined },
            { label: 'name only', text: featureName },
            { label: 'description only', text: featureDesc },
        ];

        for (const strategy of strategies) {
            if (!strategy.text) continue;
            const pattern = buildPattern(strategy.text);
            const candidate = page.getByRole('checkbox', { name: pattern });
            const candidateCount = await candidate.count();
            if (candidateCount > 0) {
                checkbox = candidateCount > 1 ? candidate.first() : candidate;
                matchedWith = strategy.label;
                console.log(`[SETTINGS]   Matched via ${strategy.label} (${candidateCount} hit(s))`);
                break;
            }
        }

        if (!checkbox) {
            console.warn(`[SETTINGS] NOT FOUND: feature #${setting.feature_id} "${labelJoined}" — skipping`);
            settingResults.push({ featureId: setting.feature_id, label: labelJoined, found: false });
            continue;
        }

        const isChecked = await checkbox.isChecked();
        if (isChecked) {
            console.log(`[SETTINGS]   Already active — skipping`);
            settingResults.push({ featureId: setting.feature_id, label: labelJoined, found: true, alreadyActive: true });
            continue;
        }

        await checkbox.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        const checkboxId = await checkbox.getAttribute('id');
        const indexMatch = checkboxId?.match(/organization_settings_attributes_(\d+)_active/);
        const settingIndex = indexMatch ? indexMatch[1] : null;

        await checkbox.check();
        await page.waitForTimeout(500);

        const accessValue = ACCESS_MAP[setting.access] ?? setting.access;
        if (settingIndex && accessValue) {
            const accessSelect = page.locator(`#organization_settings_attributes_${settingIndex}_access`);
            if (await accessSelect.count() > 0) {
                await accessSelect.scrollIntoViewIfNeeded();
                await page.waitForTimeout(300);
                await accessSelect.selectOption({ value: accessValue });
                console.log(`[SETTINGS]   Set access to ${accessValue}`);
            }
        }

        settingResults.push({ featureId: setting.feature_id, label: labelJoined, found: true, matchedWith, settingIndex });
    }

    // Log summary
    console.log('\n[SETTINGS] ========== RESULTS ==========');
    for (const r of settingResults) {
        console.log(`[SETTINGS]   Feature #${r.featureId}: found=${r.found}, index=${r.settingIndex || 'n/a'}`);
    }
    console.log('[SETTINGS] ==============================\n');

    console.log('[SETTINGS] Submitting updated organization...');
    await page.getByRole('button', { name: 'Update Organization' }).click();
    await page.waitForLoadState('networkidle');
    console.log('[SETTINGS] Settings applied successfully!');

    return settingResults;
}
