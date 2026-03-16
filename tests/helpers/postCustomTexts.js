/**
 * POST custom texts (one per language) to the superadmin API.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} csrf
 * @param {string} orgId
 * @param {Array}  customTexts
 * @returns {Promise<Array>} results
 */
export async function postCustomTexts(page, baseUrl, csrf, orgId, customTexts) {
    if (!customTexts || customTexts.length === 0) {
        console.log('\n[CUSTOM_TEXTS] No custom texts found — skipping');
        return [];
    }

    console.log(`\n[CUSTOM_TEXTS] ${customTexts.length} custom text(s) to POST`);

    const ctResults = [];

    for (const ct of customTexts) {
        const contentStr = typeof ct.content === 'string' ? ct.content : JSON.stringify(ct.content);
        const langId = String(ct.language_id);

        console.log(`[CUSTOM_TEXTS] POST custom_texts | language_id=${langId} | ${contentStr.length} chars`);

        try {
            const response = await page.request.post(`${baseUrl}/superadmin/custom_texts`, {
                form: {
                    'utf8': '✓',
                    'authenticity_token': csrf,
                    'custom_text[resource_type]': 'Organization',
                    'custom_text[resource_id]': String(orgId),
                    'custom_text[language_id]': langId,
                    'custom_text[content]': contentStr,
                },
                maxRedirects: 0,
            });

            const status = response.status();
            if (status === 302 || (status >= 200 && status < 300)) {
                const location = response.headers()['location'] || '';
                console.log(`[CUSTOM_TEXTS]   OK (${status})${location ? ' → ' + location : ''}`);
                ctResults.push({ id: ct.id, languageId: langId, status: 'created' });
            } else {
                const body = await response.text();
                console.error(`[CUSTOM_TEXTS]   FAIL (${status}): ${body.substring(0, 200)}`);
                ctResults.push({ id: ct.id, languageId: langId, status: 'failed', httpStatus: status });
            }
        } catch (err) {
            console.error(`[CUSTOM_TEXTS]   ERROR: ${err.message}`);
            ctResults.push({ id: ct.id, languageId: langId, status: 'failed', error: err.message });
        }
    }

    const created = ctResults.filter(r => r.status === 'created').length;
    console.log(`\n[CUSTOM_TEXTS] Done: ${created}/${ctResults.length} created`);

    return ctResults;
}
