import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {

    const companyData = {
        name: `Test Company ${Date.now()}`,
        companyType: 'retailer',
        allowDiamonds: 'true',
        allowGemstones: 'true',
        allowJewelry: 'true',
        allowLabGrownDiamonds: 'true',
        locationName: 'India',
        country: 'India',
        city: 'Agar',

        contactEmail: `chaman+company_${Date.now()}@vdbapp.com`,
        group: '1604',
    };

    // await page.goto(`${process.env.STAGE_BASE_URL}/superadmin/login`, {
    //     waitUntil: 'networkidle',
    // });
    await page.goto(`https://vdb-preprod-3.preprod.customvirtual.app/superadmin/login`, {
        timeout: 3000,
        waitUntil: 'networkidle',
    });
    await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
    await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.getByRole('link', { name: 'Companies & Groups' }).hover();
    await page.getByRole('link', { name: 'Companies', exact: true }).click();
    await page.getByRole('link', { name: 'New Company' }).click();
    await page.getByRole('textbox', { name: 'Name*', exact: true }).fill(companyData.name);
    await page.getByLabel('Company Type*').selectOption(companyData.companyType);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow diamonds?')
        .selectOption(companyData.allowDiamonds);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow gemstones?')
        .selectOption(companyData.allowGemstones);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow jewelry?')
        .selectOption(companyData.allowJewelry);

    await page
        .getByRole('group', { name: 'Manage Stock Items in VIMS' })
        .getByLabel('Allow lab grown diamonds?')
        .selectOption(companyData.allowLabGrownDiamonds);

    await page.getByRole('textbox', { name: 'Location name*' }).fill(companyData.locationName);
    await page.getByLabel('Country*').selectOption(companyData.country);
    await page.getByLabel('City').selectOption(companyData.city);
    await page.getByRole('textbox', { name: 'Contact email' }).fill(companyData.contactEmail);

    await page.getByRole('link', { name: 'Add to another group' }).click();
    await page.getByLabel('Group', { exact: true }).selectOption(companyData.group);

    await page.getByRole('button', { name: 'Create Company' }).click();

    await page.locator('#companies').getByRole('link', { name: 'Companies' }).click();
    await page.getByRole('textbox', { name: 'Name' }).click();
    await page.getByRole('button', { name: 'Filter' }).click();
});
