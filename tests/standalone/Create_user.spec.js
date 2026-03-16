import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

test('create multiple users dynamically', async ({ page }) => {

    // ── Read config from data file (written by the server) or fall back to env vars ──
    let baseUrl, email, password, companyId, name, numberOfUsers;

    const dataFilePath = process.env.REPLICATION_DATA_FILE;
    if (dataFilePath) {
        const config = JSON.parse(readFileSync(dataFilePath, 'utf-8'));
        baseUrl = config.baseUrl;
        email = config.email;
        password = config.password;
        companyId = config.companyId;
        name = config.name || 'Automation';
        numberOfUsers = config.numberOfUsers || 3;
    } else {
        // Legacy fallback: env vars (for running standalone)
        baseUrl = process.env.BUSINESS_DEMO_BASE_URL;
        email = process.env.BUSINESS_DEMO_SUPERADMIN_EMAIL;
        password = process.env.BUSINESS_DEMO_SUPERADMIN_PASSWORD;
        companyId = '204542';
        name = 'Automation';
        numberOfUsers = 3;
    }

    // -----------------------------
    // Login (only once)
    // -----------------------------

    await page.goto(`${baseUrl}/superadmin/login`, {
        timeout: 30000,
        waitUntil: 'networkidle',
    });

    await page.getByRole('textbox', { name: 'Email*' }).fill(email);
    await page.getByRole('textbox', { name: 'Password*' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await page.waitForLoadState('networkidle');

    for (let i = 1; i <= numberOfUsers; i++) {
        // -----------------------------
        // User Data (always unique)
        // -----------------------------

        const timestamp = Date.now();

        const userData = {
            company: companyId,
            firstName: `${name}${i}`,
            lastName: `${name}${timestamp}`,
            username: `${name.toLowerCase()}_${timestamp}_${i}`,
            email: `chaman+${name.toLowerCase()}_${timestamp}_${i}@vdbapp.com`,
            status: 'activated',
            password: 'vdb54321',
            visibility: '1',
        };

        // -----------------------------
        // Create User Flow
        // -----------------------------

        await page.getByRole('link', { name: 'New User' }).click();

        await page.getByLabel('Company').click();
        await page.waitForLoadState('networkidle');
        await page.getByLabel('Company').selectOption(userData.company);

        await page.getByRole('textbox', { name: 'First name*' }).fill(userData.firstName);
        await page.getByRole('textbox', { name: 'Last name*' }).fill(userData.lastName);
        await page.getByRole('textbox', { name: 'Username*' }).fill(userData.username);
        await page.getByRole('textbox', { name: 'Email*' }).fill(userData.email);

        await page.getByLabel('Status', { exact: true }).selectOption(userData.status);
        await page.getByRole('textbox', { name: 'Password*' }).fill(userData.password);
        await page.getByLabel('Visibility').selectOption(userData.visibility);

        await page.getByRole('button', { name: 'Create User' }).click();

        await page.waitForTimeout(3000);
        await page.goto(`${baseUrl}/superadmin/users/`, {
            timeout: 30000,
            waitUntil: 'networkidle',
        });

        console.log(`[USER] Created user ${i}/${numberOfUsers}: ${userData.username}`);
    }
});
