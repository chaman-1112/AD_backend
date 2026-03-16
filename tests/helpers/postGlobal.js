/**
 * POST a global record to the superadmin API.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} csrf
 * @param {string} orgId
 * @param {Array}  globals - array of global objects (uses first one)
 */
export async function postGlobal(page, baseUrl, csrf, orgId, globals) {
    if (!globals || globals.length === 0) {
        console.log('\n[GLOBAL] No global found — skipping');
        return;
    }

    const g = globals[0];
    const contentStr = typeof g.content === 'string' ? g.content : JSON.stringify(g.content);

    console.log(`\n[GLOBAL] POSTing global (id=${g.id}) | ${contentStr.length} chars`);

    try {
        const response = await page.request.post(`${baseUrl}/superadmin/globals`, {
            form: {
                'utf8': '✓',
                'authenticity_token': csrf,
                'global[resource_type]': 'Organization',
                'global[resource_id]': String(orgId),
                'global[content]': contentStr,
            },
            maxRedirects: 0,
        });

        const status = response.status();
        if (status === 302 || (status >= 200 && status < 300)) {
            const location = response.headers()['location'] || '';
            console.log(`[GLOBAL]   OK (${status})${location ? ' → ' + location : ''}`);
        } else {
            const body = await response.text();
            console.error(`[GLOBAL]   FAIL (${status}): ${body.substring(0, 200)}`);
        }
    } catch (err) {
        console.error(`[GLOBAL]   ERROR: ${err.message}`);
    }
}
