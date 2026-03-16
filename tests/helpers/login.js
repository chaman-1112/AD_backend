/**
 * Login to superadmin panel.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl  - e.g. https://app.example.com
 * @param {string} email
 * @param {string} password
 */
export async function login(page, baseUrl, email, password) {
    console.log('[LOGIN] Logging into superadmin...');
    await page.goto(`${baseUrl}/superadmin/login`, { waitUntil: 'networkidle' });

    await page.getByRole('textbox', { name: 'Email*' }).fill(email);
    await page.getByRole('textbox', { name: 'Password*' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForLoadState('networkidle');
    console.log('[LOGIN] Login successful');
}
