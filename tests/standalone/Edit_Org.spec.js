import { test, expect } from '@playwright/test';

// ===================================
// Settings to find, click, and configure
// ===================================
const SETTINGS = [
    {
        name: 'salespersonModel',
        text: "Enable Salesperson Model (Assign Sales People to Companies) Admin users can assign a salesperson to a company. All requests from the company are received by the assigned salesperson. Company users see the assigned salesperson's contact information",
        access: 'access_public',
        index: 0,
    },
    {
        name: 'autoActivation',
        text: "Enable auto-activation for B2B Custom App (This switch will enable the auto-activation of the users, and the user will be able to login post-email verification. Users will be tied to the default pricing group. )",
        access: 'access_private',
        index: 1,
    },
    {
        name: 'disableProductUIV2Android',
        text: "Disable Product UI V2 On Android",
        access: 'access_public',
        index: 2,
    },
    {
        name: 'askAQuestion',
        text: "Enable Ask a Question (By enabling this feature, users can ask a question related to any item appearing on the app.)",
        access: 'both',
        index: 3,
    },
    {
        name: 'replyToShareEmail',
        text: "Set 'Reply-to' for share email as user email who actually share (This will set the reply to of the share emails to the user's email who is actually sharing it.)",
        access: 'access_public',
        index: 4,
    },
    {
        name: 'showPricesWithQuality',
        text: "show prices with quality",
        access: 'access_public',
        index: 5,
    },
];

test('Edit Org — Toggle settings and configure access', async ({ page }) => {

    // ===================================
    // Login
    // ===================================

    await page.goto(`${process.env.STAGE_BASE_URL}/superadmin/login`, {
        waitUntil: 'networkidle',
    });

    await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
    await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.getByRole('button', { name: 'Login' }).click(),
    ]);

    // ===================================
    // Navigate to Edit Organization
    // ===================================

    await page.goto(`${process.env.STAGE_BASE_URL}/superadmin/organizations/${process.env.STAGE_EDIT_ORG_ID}/edit`, {
        waitUntil: 'networkidle',
    });
    await page.waitForLoadState('networkidle');

    // ===================================
    // Find, click, and store IDs for each setting
    // ===================================

    const settingResults = [];

    for (const setting of SETTINGS) {
        console.log(`\n--- Looking for setting: "${setting.name}" ---`);

        // Target the checkbox directly by its accessible name (the full label text)
        const checkbox = page.getByRole('checkbox', { name: setting.text });

        // Check if the checkbox exists in the DOM
        const count = await checkbox.count();
        if (count === 0) {
            console.warn(`Setting NOT FOUND in DOM: "${setting.name}" — skipping`);
            settingResults.push({ name: setting.name, found: false, id: null });
            continue;
        }

        // Scroll into view
        await checkbox.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        // Extract the checkbox id (e.g. "organization_settings_attributes_27_active")
        const checkboxId = await checkbox.getAttribute('id');
        console.log(`  Found checkbox id: ${checkboxId}`);

        // Extract the setting index number from the id (e.g. "27")
        const indexMatch = checkboxId?.match(/organization_settings_attributes_(\d+)_active/);
        const settingIndex = indexMatch ? indexMatch[1] : null;
        console.log(`  Setting index: ${settingIndex}`);

        // Check the checkbox if not already checked
        const isChecked = await checkbox.isChecked();
        if (!isChecked) {
            await checkbox.check();
            console.log(`  Checkbox checked (was unchecked)`);
        } else {
            console.log(`  Checkbox already checked`);
        }

        // Wait for the "Accessed by?" dropdown to potentially appear after checking
        await page.waitForTimeout(500);

        // After enabling, look for the child "Accessed by?" dropdown using the setting index
        if (settingIndex) {
            const accessSelectId = `organization_settings_attributes_${settingIndex}_access`;
            const accessSelect = page.locator(`#${accessSelectId}`);
            const accessExists = await accessSelect.count() > 0;

            if (accessExists) {
                await accessSelect.scrollIntoViewIfNeeded();
                await page.waitForTimeout(300);

                // Log available options for debugging
                const options = await accessSelect.locator('option').allTextContents();
                console.log(`  Available options: ${JSON.stringify(options)}`);

                // Set access from the setting object (match by value attribute)
                await accessSelect.selectOption({ value: setting.access });
                console.log(`  Set "Accessed by?" to ${setting.access}`);
            } else {
                console.log(`  No "Accessed by?" dropdown found for this setting`);
            }
        }

        settingResults.push({
            name: setting.name,
            found: true,
            id: checkboxId,
            settingIndex,
        });
    }

    // Log all collected setting results
    console.log('\n========== SETTING RESULTS ==========');
    for (const result of settingResults) {
        console.log(`  ${result.name}: found=${result.found}, id=${result.id}, index=${result.settingIndex}`);
    }
    console.log('======================================\n');

    // ===================================
    // Submit
    // ===================================

    await page.getByRole('button', { name: 'Update Organization' }).click();
    await page.waitForLoadState('networkidle');

});