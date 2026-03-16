import { getCsrfToken } from './getCsrfToken.js';

/**
 * Create a JsonNavigationMenu for the new organization via superadmin API.
 *
 * Direct POST to /superadmin/json_navigation_menus (create, not update).
 * Falls back to browser form submission if the API call fails.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} csrf
 * @param {string} orgId       - target (new) org ID
 * @param {object|null} navMenu - row from custom_texts where type='JsonNavigationMenu'
 * @returns {Promise<string>} possibly-refreshed csrf
 */
export async function postJsonNavigationMenu(page, baseUrl, csrf, orgId, navMenu) {
    if (!navMenu) {
        console.log('\n[NAV_MENU] No JsonNavigationMenu found — skipping');
        return csrf;
    }

    const contentStr = typeof navMenu.content === 'string'
        ? navMenu.content
        : JSON.stringify(navMenu.content);

    console.log(`\n[NAV_MENU] Creating JsonNavigationMenu (source id=${navMenu.id}) for org #${orgId} | ${contentStr.length} chars`);

    let created = false;

    // Attempt 1: Direct API POST
    try {
        const response = await page.request.post(`${baseUrl}/superadmin/json_navigation_menus`, {
            form: {
                'utf8': '✓',
                'authenticity_token': csrf,
                'json_navigation_menu[resource_type]': 'Organization',
                'json_navigation_menu[resource_id]': String(orgId),
                'json_navigation_menu[content]': contentStr,
                'commit': 'Create Json navigation menu',
            },
            maxRedirects: 0,
        });

        const status = response.status();
        if (status === 302 || (status >= 200 && status < 300)) {
            const location = response.headers()['location'] || '';
            console.log(`[NAV_MENU]   OK (${status})${location ? ' → ' + location : ''}`);
            created = true;
        } else {
            console.warn(`[NAV_MENU]   FAIL (${status}) — will retry with fresh CSRF...`);
        }
    } catch (err) {
        console.warn(`[NAV_MENU]   ERROR: ${err.message} — will retry...`);
    }

    // Attempt 2: Refresh CSRF and retry API POST
    if (!created) {
        try {
            const freshCsrf = await getCsrfToken(page, baseUrl);
            if (freshCsrf) {
                csrf = freshCsrf;
                const response = await page.request.post(`${baseUrl}/superadmin/json_navigation_menus`, {
                    form: {
                        'utf8': '✓',
                        'authenticity_token': freshCsrf,
                        'json_navigation_menu[resource_type]': 'Organization',
                        'json_navigation_menu[resource_id]': String(orgId),
                        'json_navigation_menu[content]': contentStr,
                        'commit': 'Create Json navigation menu',
                    },
                    maxRedirects: 0,
                });

                const status = response.status();
                if (status === 302 || (status >= 200 && status < 300)) {
                    const location = response.headers()['location'] || '';
                    console.log(`[NAV_MENU]   OK on retry (${status})${location ? ' → ' + location : ''}`);
                    created = true;
                } else {
                    console.warn(`[NAV_MENU]   Retry also failed (${status}) — trying browser form...`);
                }
            }
        } catch (err) {
            console.warn(`[NAV_MENU]   Retry error: ${err.message} — trying browser form...`);
        }
    }

    // Attempt 3: Browser form submission (last resort)
    if (!created) {
        try {
            await page.goto(`${baseUrl}/superadmin/json_navigation_menus/new`, { waitUntil: 'networkidle' });

            const resourceTypeSelect = page.locator('#json_navigation_menu_resource_type');
            if (await resourceTypeSelect.count() > 0) {
                await resourceTypeSelect.selectOption('Organization');
                await page.waitForLoadState('networkidle');
            }

            const resourceIdField = page.locator('#json_navigation_menu_resource_id');
            if (await resourceIdField.count() > 0) {
                const tagName = await resourceIdField.evaluate(e => e.tagName.toLowerCase());
                if (tagName === 'select') {
                    await resourceIdField.selectOption(String(orgId));
                } else {
                    await resourceIdField.fill(String(orgId));
                }
                await page.waitForLoadState('networkidle');
            }

            const contentField = page.locator('#json_navigation_menu_content');
            if (await contentField.count() > 0) {
                await contentField.fill(contentStr);
            }

            const reasonField = page.locator('#json_navigation_menu_reason_for_change');
            if (await reasonField.count() > 0) {
                await reasonField.fill('Replicated from source organization');
            }

            const createBtn = page.getByRole('button', { name: /create/i });
            if (await createBtn.count() > 0) {
                await createBtn.click();
                await page.waitForLoadState('networkidle');
            }

            const currentUrl = page.url();
            if (currentUrl.includes('/edit') || /\/\d+$/.test(currentUrl)) {
                console.log(`[NAV_MENU]   OK via browser form → ${currentUrl}`);
                created = true;
            } else {
                console.error(`[NAV_MENU]   Browser form failed → ${currentUrl}`);
            }
        } catch (err) {
            console.error(`[NAV_MENU]   Browser form error: ${err.message}`);
        }
    }

    if (!created) {
        console.error(`[NAV_MENU]   All attempts failed`);
    }

    const newCsrf = await getCsrfToken(page, baseUrl);
    return newCsrf || csrf;
}
