/**
 * Extract the CSRF token from the current page or navigate to get one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<string|null>} csrf token
 */
export async function getCsrfToken(page, baseUrl) {
    const readCsrf = () => page.evaluate(() =>
        document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    );

    let csrf = await readCsrf();
    if (csrf) return csrf;

    const candidates = [
        `${baseUrl}/superadmin/organizations`,
        `${baseUrl}/superadmin/theme_white_labelings`,
        `${baseUrl}/superadmin/custom_search_menus`,
    ];

    for (const url of candidates) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        csrf = await readCsrf();
        if (csrf) return csrf;
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/superadmin/login')) {
        console.error('[CSRF] Could not obtain CSRF token (session appears logged out)');
    } else {
        console.error(`[CSRF] Could not obtain CSRF token (current page: ${currentUrl})`);
    }

    return null;
}
