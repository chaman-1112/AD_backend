/**
 * parseCompanyData.js
 *
 * Transforms a raw company database row into a flat object
 * ready to drive Playwright form-filling for company creation.
 */

function safeParse(value) {
    if (!value || typeof value !== 'string') return value ?? {};
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

/**
 * @param {object} raw — A single company row from the database.
 * @returns {object}     A flat companyData object for Playwright tests.
 */
export function parseCompanyData(raw) {
    const allowStockTypes = safeParse(raw.allow_stock_types);
    const dataUrl = safeParse(raw.data_url);
    const additionalAttributes = safeParse(raw.additional_attributes);

    return {
        // ---- identifiers ----
        id: raw.id,
        name: raw.name,
        organizationId: raw.organization_id,

        // ---- company info ----
        companyType: raw.company_type || '',
        companyCode: raw.company_code || '',

        // ---- stock types ----
        allowDiamonds: allowStockTypes.diamond || 'false',
        allowGemstones: allowStockTypes.gemstone || 'false',
        allowJewelry: allowStockTypes.jewelry || 'false',
        allowLabGrownDiamonds: allowStockTypes.lab_grown_diamond || 'false',
        defaultStockType: allowStockTypes.default_stock_type || '',

        // ---- location ----
        country: raw.country || 'India',
        state: raw.state || '',
        city: raw.city || '',
        streetAddress: raw.street_address || '',
        zipCode: raw.zip_code || '',

        // ---- contact ----
        requestEmailAddress: raw.request_email_address || 'abc1234567890@gmail.com',
        contactIphone: raw.contact_iphone || '1234567890',
        mobilePhone: raw.mobile_phone || '1234567890',
        website: raw.website || 'http://www.google.com',

        // ---- data format ----  
        dataFormat: raw.data_format || 'csv',

        // ---- flags ----
        acceptsMemo: raw.accepts_memo ?? false,
        canSetLogo: raw.can_set_logo ?? false,
        searchPref: raw.search_pref ?? false,
        studioPro: raw.studio_pro ?? false,
        showVdbWatermark: raw.show_vdb_watermark ?? false,
        canSetWatermark: raw.can_set_watermark ?? false,
        calDiscPercent: raw.cal_disc_percent ?? false,
        hasMultipleLocations: raw.has_multiple_locations ?? false,
        allowCustomMenu: String(raw.allow_custom_menu ?? true),
        allowCustomMenuTypes: safeParse(raw.allow_custom_menu_types),
        allowSearchCoachOverlay: raw.allow_search_coach_overlay ?? true,
        allowWelcomeScreen: raw.allow_welcome_screen ?? true,
        allowLabGrown: raw.allow_lab_grown ?? false,
        showPoweredByVdb: raw.show_powered_by_vdb ?? true,
        autoActivate: raw.auto_activate ?? false,
        iframeStatus: raw.iframe_status ?? false,
        allowCustomTheme: String(raw.allow_custom_theme ?? false),
        allowCustomThemeTypes: safeParse(raw.allow_custom_theme_types),
        hasPriceMarkups: raw.has_price_markups ?? false,

        // ---- data urls ----
        diamondDataUrl: dataUrl.diamond_data_url || '',
        gemstoneDataUrl: dataUrl.gemstone_data_url || '',
        jewelryDataUrl: dataUrl.jewelry_data_url || '',
        labGrownDataUrl: dataUrl.lab_grown_data_url || '',
        useProxy: dataUrl.use_proxy || 'false',

        // ---- misc ----
        defaultMarkup: raw.default_markup ?? 0,
        salesforceId: raw.salesforce_id || '',
        hubspotId: raw.hubspot_id || '',
    };
}

/**
 * Returns only the fields needed for the company creation form.
 */
export function parseCompanyDataForTests(raw) {
    const full = parseCompanyData(raw);
    return {
        name: full.name,
        companyType: full.companyType,
        allowDiamonds: full.allowDiamonds,
        allowGemstones: full.allowGemstones,
        allowJewelry: full.allowJewelry,
        allowLabGrownDiamonds: full.allowLabGrownDiamonds,
        country: full.country,
        city: full.city,
        requestEmailAddress: full.requestEmailAddress,
    };
}
