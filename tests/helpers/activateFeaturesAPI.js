import pool from '../utils/db.js';

/**
 * Activates feature switches for a company using native fetch().
 *
 * @param {import('@playwright/test').Page} page - Playwright page (logged-in, used to extract cookies/CSRF)
 * @param {number} sourceCompanyId - Company ID to copy features FROM
 * @param {number} targetCompanyId - Company ID to copy features TO
 * @param {string} baseUrl - Base URL for the application
 * @param {Array<{feature_id:number, feature_name?:string}>} [sourceActiveFeatures] - Optional pre-fetched active features from source
 */
export async function activateFeaturesAPI(page, sourceCompanyId, targetCompanyId, baseUrl, sourceActiveFeatures = null) {
    console.log(`[FEATURES API] Starting feature activation`);
    console.log(`[FEATURES API] Source Company: ${sourceCompanyId}`);
    console.log(`[FEATURES API] Target Company: ${targetCompanyId}`);

    try {
        let sourceRows = Array.isArray(sourceActiveFeatures) ? sourceActiveFeatures : [];
        if (sourceRows.length === 0) {
            console.log(`[FEATURES API] Fetching active feature settings from source company...`);
            const sourceQuery = `
                SELECT s.feature_id, s.id as settings_id, f.name as feature_name
                FROM settings s
                JOIN features f ON s.feature_id = f.id
                WHERE s.settable_id = $1
                AND s.settable_type = 'Company'
                AND s.active = true
                ORDER BY s.feature_id
            `;
            const sourceResult = await pool.query(sourceQuery, [sourceCompanyId]);
            sourceRows = sourceResult.rows;
        } else {
            console.log(`[FEATURES API] Using pre-fetched source feature settings (${sourceRows.length})`);
        }

        if (sourceRows.length === 0) {
            console.log(`[FEATURES API] No feature settings found in source company`);
            return { activated: 0, failed: 0 };
        }

        console.log(`[FEATURES API] Found ${sourceRows.length} feature settings in source company`);

        const featureIds = sourceRows.map(row => row.feature_id);
        console.log(`[FEATURES API] Feature IDs to copy: ${featureIds.join(', ')}`);

        sourceRows.slice(0, 5).forEach(row => {
            console.log(`[FEATURES API]   - ${row.feature_name} (ID: ${row.feature_id})`);
        });
        if (sourceRows.length > 5) {
            console.log(`[FEATURES API]   ... and ${sourceRows.length - 5} more`);
        }

        const targetQuery = `
            SELECT s.feature_id, s.id as settings_id, f.name as feature_name, s.active
            FROM settings s
            JOIN features f ON s.feature_id = f.id
            WHERE s.settable_id = $1
            AND s.settable_type = 'Company'
            AND s.feature_id = ANY($2::int[])
            ORDER BY s.feature_id
        `;
        const targetResult = await pool.query(targetQuery, [targetCompanyId, featureIds]);
        const inactiveTargetRows = targetResult.rows.filter((row) => !row.active);

        const alreadyActive = sourceRows.length - inactiveTargetRows.length;

        if (inactiveTargetRows.length === 0) {
            console.log(`[FEATURES API] All ${sourceRows.length} features are already active in target company`);
            return { activated: 0, failed: 0, alreadyActive: sourceRows.length };
        }

        if (alreadyActive > 0) {
            console.log(`[FEATURES API] ${alreadyActive} features already active in target, skipping those`);
        }
        console.log(`[FEATURES API] Found ${inactiveTargetRows.length} inactive features to activate in target company`);

        // Navigate to settings page to get CSRF token
        console.log(`[FEATURES API] Fetching CSRF token...`);
        await page.goto(`${baseUrl}/superadmin/company_settings?q%5Bsettable_id_eq%5D=${targetCompanyId}`, {
            waitUntil: 'networkidle',
        });

        const csrfToken = await page.evaluate(() => {
            const metaTag = document.querySelector('meta[name="csrf-token"]');
            return metaTag ? metaTag.getAttribute('content') : '';
        });

        if (!csrfToken) {
            console.log(`[FEATURES API] WARNING: Could not find CSRF token, proceeding without it`);
        } else {
            console.log(`[FEATURES API] CSRF token obtained`);
        }

        // Extract cookies from browser context for native fetch
        const cookies = await page.context().cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // HTTP basic auth from env (vdborg001 creds)
        const httpUser = process.env.STAGE_HTTP_USERNAME || 'vdborg001';
        const httpPass = process.env.STAGE_HTTP_PASSWORD || 'letscreateorgs@078';
        const basicAuth = 'Basic ' + Buffer.from(`${httpUser}:${httpPass}`).toString('base64');

        let activated = 0;
        let failed = 0;

        for (const setting of inactiveTargetRows) {
            const url = `${baseUrl}/superadmin/company_settings/${setting.settings_id}/enable`;

            try {
                console.log(`[FEATURES API] Activating: ${setting.feature_name} (feature_id: ${setting.feature_id}, settings_id: ${setting.settings_id})`);

                const formBody = new URLSearchParams({
                    _method: 'put',
                    authenticity_token: csrfToken,
                });

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': cookieString,
                        'Authorization': basicAuth,
                        'Origin': baseUrl,
                        'Referer': `${baseUrl}/superadmin/company_settings?q%5Bsettable_id_eq%5D=${targetCompanyId}`,
                        'X-CSRF-Token': csrfToken,
                    },
                    body: formBody.toString(),
                    redirect: 'manual',
                });

                const status = response.status;
                if (status === 200 || status === 302 || status === 303) {
                    console.log(`[FEATURES API] ✓ ${setting.feature_name} activated successfully (HTTP ${status})`);
                    activated++;
                } else {
                    const errorBody = await response.text().catch(() => '');
                    const errorPreview = errorBody ? ` | ${errorBody.slice(0, 140).replace(/\s+/g, ' ')}` : '';
                    console.log(`[FEATURES API] ✗ ${setting.feature_name} failed (HTTP ${status})${errorPreview}`);
                    failed++;
                }

                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (error) {
                console.log(`[FEATURES API] ✗ ${setting.feature_name} error: ${error.message}`);
                failed++;
            }
        }

        console.log(`[FEATURES API] Activation complete: ${activated} succeeded, ${failed} failed`);
        return { activated, failed };

    } catch (error) {
        console.error(`[FEATURES API] Fatal error: ${error.message}`);
        throw error;
    }
}
