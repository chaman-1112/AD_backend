import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {

    // ===================================
    // Organization Data Object
    // ===================================

    const organizationData = {
        name: `Test Org ${Date.now()}`,
        domainUrl: `test-org-${Date.now()}`,
        status: 'active',
        androidAppIdentifier: 'as',
        iosAppIdentifier: 'asa',
        apn: 'asa',
        ibi: 'asa',
        isi: 'as',
        loginDeeplink: 'asaa',
        baseUrl: 'ss',
        linkUrl: 'ds',
        faviconUrl: 'favicon',
        iframeStatus: true,
        webStatus: true,
        publicKey: 'sdd',
        externalLandingPageUrl: 'sd',
        internalLandingPageUrl: 'sds',
        internalLandingPageUrlV3: 'sd',
        externalLandingPageUrlV3: 'ew',
        wellknownExternalLanding: 'we',
        wellknownInternalLanding: 'ew',
        customHeaderHtml: 'header',
        allowDiamonds: 'both',
        allowGemstones: 'both',
        allowJewelry: 'both',
        allowLabGrownDiamonds: 'both',
        diamondsView: 'suppress_grid_view',
        gemstonesView: 'suppress_list_view',
        jewelryView: 'show_both_default_as_list',
        businessPlan: 'Advanced (B2B2C app)',
    };

    // ===================================
    // Login
    // ===================================

    await page.goto(`${process.env.STAGE_BASE_URL}/superadmin/login`, {
        waitUntil: 'networkidle',
    });

    await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
    await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();

    // ===================================
    // Navigate to Organizations
    // ===================================

    await page.getByRole('link', { name: 'Organizations' }).click();

    // ===================================
    // Create New Organization
    // ===================================

    await page.getByRole('link', { name: 'New Organization' }).click();

    // Basic Info
    await page.getByRole('textbox', { name: 'Name*' }).fill(organizationData.name);
    await page.getByRole('textbox', { name: 'Domain url*' }).fill(organizationData.domainUrl);
    await page.getByLabel('Status', { exact: true }).selectOption(organizationData.status);

    // App Identifiers
    await page.getByRole('textbox', { name: 'Android app identifier' }).fill(organizationData.androidAppIdentifier);
    await page.getByRole('textbox', { name: 'iOS app identifier' }).fill(organizationData.iosAppIdentifier);

    // Deep Link Settings
    await page.getByRole('textbox', { name: 'Apn*' }).fill(organizationData.apn);
    await page.getByRole('textbox', { name: 'Ibi*' }).fill(organizationData.ibi);
    await page.getByRole('textbox', { name: 'Isi*' }).fill(organizationData.isi);
    await page.getByRole('textbox', { name: 'Login deeplink*' }).fill(organizationData.loginDeeplink);
    await page.getByRole('textbox', { name: 'Base url*' }).fill(organizationData.baseUrl);
    await page.getByRole('textbox', { name: 'Link url*' }).fill(organizationData.linkUrl);

    // Appearance
    await page.getByRole('textbox', { name: 'Favicon url' }).fill(organizationData.faviconUrl);

    // Iframe & Web Status
    if (organizationData.iframeStatus) {
        await page.getByRole('checkbox', { name: 'Iframe status' }).check();
    }
    if (organizationData.webStatus) {
        await page.getByRole('checkbox', { name: 'Web status' }).check();
    }

    // Security
    await page.getByRole('textbox', { name: 'Public key' }).fill(organizationData.publicKey);

    // Landing Pages
    await page.getByRole('textbox', { name: 'External landing page url', exact: true }).fill(organizationData.externalLandingPageUrl);
    await page.getByRole('textbox', { name: 'Internal landing page url', exact: true }).fill(organizationData.internalLandingPageUrl);
    await page.getByRole('textbox', { name: 'Internal landing page url v3' }).fill(organizationData.internalLandingPageUrlV3);
    await page.getByRole('textbox', { name: 'External landing page url v3' }).fill(organizationData.externalLandingPageUrlV3);
    await page.getByRole('textbox', { name: 'Wellknown external landing' }).fill(organizationData.wellknownExternalLanding);
    await page.getByRole('textbox', { name: 'Wellknown internal landing' }).fill(organizationData.wellknownInternalLanding);

    // Custom Header
    await page.getByRole('textbox', { name: 'Custom header html' }).fill(organizationData.customHeaderHtml);

    // Stock Item Permissions
    await page.getByLabel('Allow diamonds?').selectOption(organizationData.allowDiamonds);
    await page.getByLabel('Allow gemstones?').selectOption(organizationData.allowGemstones);
    await page.getByLabel('Allow jewelry?').selectOption(organizationData.allowJewelry);
    await page.getByLabel('Allow lab-grown diamonds?').selectOption(organizationData.allowLabGrownDiamonds);

    // View Settings
    await page.getByLabel('diamonds?', { exact: true }).selectOption(organizationData.diamondsView);
    await page.getByLabel('gemstones?', { exact: true }).selectOption(organizationData.gemstonesView);
    await page.getByLabel('Jewelry?', { exact: true }).selectOption(organizationData.jewelryView);

    // Business Plan
    await page.getByLabel('Business plan').selectOption(organizationData.businessPlan);

    // ===================================
    // Submit
    // ===================================

    await page.getByRole('button', { name: 'Create Organization' }).click();

    // ===================================
    // Verify - Navigate back to list
    // ===================================

    await page.goto(`${process.env.STAGE_BASE_URL}/superadmin/organizations`, {
        waitUntil: 'networkidle',
    });
});
