import { getCsrfToken } from './getCsrfToken.js';

/**
 * POST customizations (PDP, SearchResult, SearchForm, ProductUnifiedPage)
 * to the superadmin API. Includes retry with multipart + browser-form fallback.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} csrf       - CSRF authenticity token
 * @param {string} orgId
 * @param {Array}  customizations
 * @returns {Promise<{ results: Array, csrf: string }>} results + possibly-refreshed csrf
 */
export async function postCustomizations(page, baseUrl, csrf, orgId, customizations) {
    if (!customizations || customizations.length === 0) {
        console.log('\n[CUSTOMIZATIONS] No customization rows found — skipping');
        return { results: [], csrf };
    }

    console.log(`\n[CUSTOMIZATIONS] ${customizations.length} rows to POST`);

    const TYPE_CONFIG = {
        'Pdp':                               { path: 'pdps',                  param: 'pdp' },
        'SearchResult':                      { path: 'search_results',        param: 'search_result' },
        'SearchForm':                        { path: 'search_forms',          param: 'search_form' },
        'ProductUnifiedPage':                { path: 'product_unified_pages', param: 'product_unified_page' },
        'Customization::Pdp':                { path: 'pdps',                  param: 'pdp' },
        'Customization::SearchResult':       { path: 'search_results',        param: 'search_result' },
        'Customization::SearchForm':         { path: 'search_forms',          param: 'search_form' },
        'Customization::ProductUnifiedPage': { path: 'product_unified_pages', param: 'product_unified_page' },
    };

    // ── Internal helpers ──

    async function refreshCsrf() {
        return getCsrfToken(page, baseUrl);
    }

    async function postForm(url, paramPrefix, fields, token) {
        return page.request.post(url, {
            form: {
                'utf8': '✓',
                'authenticity_token': token,
                [`${paramPrefix}[resource_id]`]: fields.resourceId,
                [`${paramPrefix}[resource_type]`]: fields.resourceType,
                [`${paramPrefix}[product_type]`]: fields.productType,
                [`${paramPrefix}[content]`]: fields.contentStr,
            },
            maxRedirects: 0,
        });
    }

    async function postMultipart(url, paramPrefix, fields, token) {
        return page.request.post(url, {
            multipart: {
                'utf8': '✓',
                'authenticity_token': token,
                [`${paramPrefix}[resource_id]`]: fields.resourceId,
                [`${paramPrefix}[resource_type]`]: fields.resourceType,
                [`${paramPrefix}[product_type]`]: fields.productType,
                [`${paramPrefix}[content]`]: fields.contentStr,
            },
            maxRedirects: 0,
        });
    }

    async function postViaBrowser(url, paramPrefix, fields) {
        console.log(`[CUSTOMIZATIONS]   Trying browser form at ${url}/new ...`);
        await page.goto(`${url}/new`, { waitUntil: 'networkidle' });

        const fillField = async (selector, value) => {
            const el = page.locator(selector);
            if (await el.count() > 0) {
                const tagName = await el.evaluate(e => e.tagName.toLowerCase());
                if (tagName === 'select') await el.selectOption(value);
                else await el.fill(value);
            }
        };

        await fillField(`#${paramPrefix}_resource_id`, fields.resourceId);
        await fillField(`#${paramPrefix}_resource_type`, fields.resourceType);
        await page.waitForLoadState('networkidle');

        // Re-fill resource_id (page may reload after type/id change)
        await fillField(`#${paramPrefix}_resource_id`, fields.resourceId);
        await page.waitForLoadState('networkidle');

        await fillField(`#${paramPrefix}_product_type`, fields.productType);

        const contentField = page.locator(`#${paramPrefix}_content`);
        if (await contentField.count() > 0) {
            await contentField.fill(fields.contentStr);
        }

        const submitBtn = page.getByRole('button', { name: /create/i });
        if (await submitBtn.count() > 0) {
            await submitBtn.click();
            await page.waitForLoadState('networkidle');
        }

        const currentUrl = page.url();
        if (currentUrl.includes('/edit') || /\/\d+$/.test(currentUrl)) {
            return { ok: true, url: currentUrl };
        }
        return { ok: false, url: currentUrl };
    }

    // ── Main loop ──

    let currentCsrf = csrf;
    const customResults = [];

    for (const c of customizations) {
        const config = TYPE_CONFIG[c.type];
        if (!config) {
            console.warn(`[CUSTOMIZATIONS] Unknown type "${c.type}" — skipping`);
            customResults.push({ id: c.id, type: c.type, status: 'skipped' });
            continue;
        }

        const contentStr = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
        const resourceType = c.resource_type || 'Organization';
        const productType = String(c.product_type);

        const url = `${baseUrl}/superadmin/${config.path}`;
        const fields = { resourceId: String(orgId), resourceType, productType, contentStr };
        console.log(`[CUSTOMIZATIONS] POST ${config.path} | type=${c.type} product_type=${productType} | ${contentStr.length} chars`);

        let created = false;

        // Attempt 1: standard form-encoded POST
        try {
            const response = await postForm(url, config.param, fields, currentCsrf);
            const status = response.status();
            if (status === 302 || (status >= 200 && status < 300)) {
                const location = response.headers()['location'] || '';
                console.log(`[CUSTOMIZATIONS]   OK (${status})${location ? ' → ' + location : ''}`);
                customResults.push({ id: c.id, type: c.type, productType, status: 'created' });
                created = true;
            } else {
                console.warn(`[CUSTOMIZATIONS]   FAIL (${status}) — will retry with multipart...`);
            }
        } catch (err) {
            console.warn(`[CUSTOMIZATIONS]   ERROR: ${err.message} — will retry...`);
        }

        // Attempt 2: multipart form-data POST
        if (!created) {
            try {
                console.log(`[CUSTOMIZATIONS]   Retry #1: multipart encoding...`);
                const freshCsrf = await refreshCsrf();
                const response = await postMultipart(url, config.param, fields, freshCsrf || currentCsrf);
                const status = response.status();
                if (status === 302 || (status >= 200 && status < 300)) {
                    const location = response.headers()['location'] || '';
                    console.log(`[CUSTOMIZATIONS]   OK via multipart (${status})${location ? ' → ' + location : ''}`);
                    customResults.push({ id: c.id, type: c.type, productType, status: 'created' });
                    created = true;
                    if (freshCsrf) currentCsrf = freshCsrf;
                } else {
                    const body = await response.text();
                    console.warn(`[CUSTOMIZATIONS]   Multipart also failed (${status}): ${body.substring(0, 200)}`);
                }
            } catch (err) {
                console.warn(`[CUSTOMIZATIONS]   Multipart error: ${err.message}`);
            }
        }

        // Attempt 3: browser form submission (last resort)
        if (!created) {
            try {
                console.log(`[CUSTOMIZATIONS]   Retry #2: browser form submission...`);
                const result = await postViaBrowser(url, config.param, fields);
                if (result.ok) {
                    console.log(`[CUSTOMIZATIONS]   OK via browser form → ${result.url}`);
                    customResults.push({ id: c.id, type: c.type, productType, status: 'created' });
                    created = true;
                } else {
                    console.error(`[CUSTOMIZATIONS]   Browser form also failed → ${result.url}`);
                }
                currentCsrf = await page.evaluate(() =>
                    document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
                ) || currentCsrf;
            } catch (err) {
                console.error(`[CUSTOMIZATIONS]   Browser form error: ${err.message}`);
            }
        }

        if (!created) {
            customResults.push({ id: c.id, type: c.type, productType, status: 'failed' });
        }
    }

    const createdCount = customResults.filter(r => r.status === 'created').length;
    console.log(`\n[CUSTOMIZATIONS] Done: ${createdCount}/${customResults.length} created`);

    return { results: customResults, csrf: currentCsrf };
}
