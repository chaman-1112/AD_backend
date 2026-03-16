import { getCsrfToken } from './getCsrfToken.js';

function buildFilePayload(configData, platform) {
    const jsonStr = typeof configData === 'string'
        ? configData
        : JSON.stringify(configData);
    return {
        name: `${platform}_white_label.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(jsonStr, 'utf-8'),
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error) {
    const msg = String(error?.message || '');
    return (
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('EAI_AGAIN')
    );
}

function isSuccessRedirect(response) {
    const status = response.status();
    const location = response.headers()['location'] || '';
    const redirectedToRecord = /\/theme_white_labelings\/\d+/.test(location);
    if (status === 302 && redirectedToRecord) {
        return { ok: true, status, location };
    }
    return { ok: false, status, location };
}

async function uploadWhiteLabel(page, csrf, baseUrl, targetOrgId, platform, filePayload) {
    return page.request.post(
        `${baseUrl}/superadmin/theme_white_labelings`,
        {
            multipart: {
                'utf8': '✓',
                'authenticity_token': csrf,
                'theme_white_labeling[resource_type]': 'Organization',
                'theme_white_labeling[resource_id]': String(targetOrgId),
                'theme_white_labeling[config_version]': '0',
                'theme_white_labeling[file_upload]': filePayload,
                'theme_white_labeling[platform]': String(platform),
                'commit': 'Create Theme white labeling',
            },
            maxRedirects: 0,
            timeout: 45000,
        }
    );
}

/**
 * Copy white label configurations from one org to another.
 * Uses the existing logged-in Playwright page — no separate browser session.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('pg').Pool} pool
 * @param {string} baseUrl
 * @param {number} sourceOrgId
 * @param {number} targetOrgId
 * @returns {Promise<{created: number, failed: number}>}
 */
export async function copyOrgWhiteLabel(page, pool, baseUrl, sourceOrgId, targetOrgId) {
    console.log(`\n[WHITE LABEL] ========== WHITE LABEL COPY ==========`);
    console.log(`[WHITE LABEL] Source Org: ${sourceOrgId} → Target Org: ${targetOrgId}`);

    const { rows } = await pool.query(
        `SELECT platform, config_data
         FROM theme_white_labelings
         WHERE resource_type = 'Organization'
           AND resource_id = $1`,
        [sourceOrgId]
    );

    if (rows.length === 0) {
        console.log(`[WHITE LABEL] No white label configurations found — skipping`);
        return { created: 0, failed: 0 };
    }

    console.log(`[WHITE LABEL] Found ${rows.length} platform(s)`);

    let created = 0;
    let failed = 0;

    for (const row of rows) {
        const { platform, config_data } = row;
        const filePayload = buildFilePayload(config_data, platform);
        const platformLabel = platform === 0 || platform === '0' ? 'Web' : 'Mobile';
        console.log(`[WHITE LABEL]   → ${platformLabel} (platform=${platform}, ${filePayload.buffer.length} bytes)`);

        let ok = false;
        let lastError = null;
        const maxAttempts = 4;

        for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
            if (attempt > 1) {
                const delayMs = attempt * 2000;
                console.log(`[WHITE LABEL]     Retry ${attempt - 1}/${maxAttempts - 1} after ${delayMs}ms...`);
                await sleep(delayMs);
            }

            try {
                const csrf = await getCsrfToken(page, baseUrl);
                const response = await uploadWhiteLabel(page, csrf, baseUrl, targetOrgId, platform, filePayload);
                const result = isSuccessRedirect(response);
                if (result.ok) {
                    console.log(`[WHITE LABEL]     ✓ Created → ${result.location}`);
                    ok = true;
                    created++;
                } else {
                    console.log(`[WHITE LABEL]     ✗ FAIL (${result.status})`);
                }
            } catch (err) {
                lastError = err;
                console.log(`[WHITE LABEL]     ✗ ERROR: ${err.message}`);
                if (!isTransientNetworkError(err)) {
                    break;
                }
            }
        }

        if (!ok) {
            if (lastError) {
                console.log(`[WHITE LABEL]     Final error after retries: ${lastError.message}`);
            }
            failed++;
        }
    }

    console.log(`[WHITE LABEL] Complete: ${created} created, ${failed} failed`);
    console.log(`[WHITE LABEL] =============================================\n`);

    if (failed > 0) {
        throw new Error(`White label copy incomplete: ${failed} platform(s) failed`);
    }

    return { created, failed };
}
