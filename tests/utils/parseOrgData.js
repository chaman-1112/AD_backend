/**
 * parseOrgData.js
 *
 * Accepts the raw database JSON response for an organization
 * and returns a flat object with every field used by the test suite.
 *
 * Usage:
 *   import { parseOrgData } from '../utils/parseOrgData.js';
 *
 *   const dbJson = { "select * from organizations where id = 832": [ { ... } ] };
 *   const orgData = parseOrgData(dbJson);
 *   // orgData is now ready to drive your Playwright tests
 */

// ---------------------------------------------------------------------------
// Lookup maps for enum-style columns
// ---------------------------------------------------------------------------

const STATUS_MAP = {
    0: 'active',
    1: 'inactive',
};

const BUSINESS_PLAN_MAP = {
    0: 'Starter',
    1: 'Professional (B2B app)',
    2: 'Enterprise',
    3: 'Advanced (B2B2C app)',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON string. Returns an empty object on failure.
 */
function safeParse(value) {
    if (!value || typeof value !== 'string') return value ?? {};
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * @param {object} dbJson – The full DB response object whose first key holds
 *                          an array with at least one organization row.
 * @returns {object}       A flat organizationData object matching the shape
 *                          expected by the test spec files.
 */
export function parseOrgData(dbJson) {
    // Extract the first row from the first (and usually only) key
    const rows = Object.values(dbJson)[0];
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('parseOrgData: No organization rows found in the provided JSON.');
    }
    const raw = rows[0];

    // ------------------------------------------------------------------
    // Parse all stringified-JSON columns
    // ------------------------------------------------------------------
    const emails          = safeParse(raw.emails);
    const phone           = safeParse(raw.phone);
    const redirectUrls    = safeParse(raw.redirect_urls);
    const searchView      = safeParse(raw.search_result_view_type);
    const allowBulk       = safeParse(raw.allow_bulk_requests);
    const customText      = safeParse(raw.custom_text);
    const deeplinkConfig  = safeParse(raw.deeplink_config);
    const settingAttrs    = safeParse(raw.setting_attributes);
    const metaData        = safeParse(raw.meta_data);
    const additionalAttrs = safeParse(raw.additional_attributes);
    const landingPages    = safeParse(raw.landing_pages);

    // ------------------------------------------------------------------
    // Build the organizationData object used by the tests
    // ------------------------------------------------------------------
    const organizationData = {
        // ---- identifiers ----
        id:   raw.id,
        name: raw.name,

        // ---- urls / domain ----
        domainUrl:  raw.domain_url,
        faviconUrl: raw.favicon_url,

        // ---- status flags ----
        status:       STATUS_MAP[raw.status] ?? String(raw.status),
        iframeStatus: raw.iframe_status,
        webStatus:    raw.web_status,

        // ---- app identifiers ----
        androidAppIdentifier: raw.android_app_identifier,
        iosAppIdentifier:     raw.ios_app_identifier,

        // ---- deeplink config ----
        apn:           deeplinkConfig.apn           ?? '',
        ibi:           deeplinkConfig.ibi           ?? '',
        isi:           deeplinkConfig.isi           ?? '',
        loginDeeplink: deeplinkConfig.login_deeplink ?? '',
        baseUrl:       deeplinkConfig.base_url       ?? '',
        linkUrl:       deeplinkConfig.link_url       ?? '',

        // ---- security ----
        publicKey: raw.public_key,

        // ---- landing pages ----
        externalLandingPageUrl:     raw.external_landing_page_url   ?? '',
        internalLandingPageUrl:     raw.internal_landing_page_url   ?? '',
        internalLandingPageUrlV3:   raw.internal_landing_page_url_v3 ?? '',
        externalLandingPageUrlV3:   raw.external_landing_page_url_v3 ?? '',
        wellknownExternalLanding:   raw.wellknown_external_landing   ?? '',
        wellknownInternalLanding:   raw.wellknown_internal_landing   ?? '',

        // ---- custom HTML ----
        customHeaderHtml: raw.custom_header_html,

        // ---- search result view types ----
        diamondsView:  searchView.diamond          ?? '',
        gemstonesView: searchView.gemstone         ?? '',
        jewelryView:   searchView.jewelry          ?? '',
        labGrownDiamondsView: searchView.lab_grown_diamond ?? '',

        // ---- allow bulk requests ----
        allowDiamonds:         allowBulk.diamond          ?? '',
        allowGemstones:        allowBulk.gemstone         ?? '',
        allowJewelry:          allowBulk.jewelry          ?? '',
        allowLabGrownDiamonds: allowBulk.lab_grown_diamond ?? '',

        // ---- business plan ----
        businessPlan: BUSINESS_PLAN_MAP[raw.business_plan] ?? String(raw.business_plan),

        // ---- primary company ----
        primaryCompanyId: raw.primary_company_id,

        // ---- emails (parsed) ----
        emails: {
            primary:          emails.primary           ?? '',
            secondary:        emails.secondary         ?? '',
            system:           emails.system            ?? '',
            support:          emails.support           ?? '',
            reports:          emails.reports           ?? '',
            bcc:              emails.bcc               ?? '',
            replyTo:          emails.reply_to          ?? '',
            contactUs:        emails.contact_us        ?? '',
            inventoryReports: emails.inventory_reports ?? '',
            qa:               emails.qa                ?? '',
            dev:              emails.dev               ?? '',
        },

        // ---- phone (parsed) ----
        phone: {
            primary: phone.primary ?? '',
        },

        // ---- redirect urls (parsed) ----
        redirectUrls: {
            logoUrl:    redirectUrls.logo_url     ?? '',
            signOutUrl: redirectUrls.sign_out_url ?? '',
        },

        // ---- custom text (parsed) ----
        customText: {
            contactUsText:                      customText.contact_us_text                        ?? '',
            loginTitleText:                     customText.login_title_text                       ?? '',
            socialRedirectLinks:                customText.social_redirect_links                  ?? '',
            unknownJewelryRingSize:             customText.unknown_jewelry_ring_size               ?? '',
            loginAlreadyMemberLabel:            customText.login_already_member_label              ?? '',
            loginLoginButtonCaption:            customText.login_login_button_caption              ?? '',
            loginNotRegisteredLabel:            customText.login_not_registered_label              ?? '',
            loginSignupButtonCaption:           customText.login_signup_button_caption             ?? '',
            organizationHomeTitleText:          customText.organization_home_title_text            ?? '',
            signupSubmitButtonCaption:          customText.signup_submit_button_caption            ?? '',
            signupRegistrationFormHeader:       customText.signup_registration_form_header         ?? '',
            orderCartShippingInstructions:      customText.order_cart_shipping_instructions        ?? '',
            shoppingCartOfflinePaymentInstructions: customText.shopping_cart_offline_payment_instructions ?? '',
        },

        // ---- setting attributes (parsed) ----
        settingAttributes: {
            onHandText:  settingAttrs.on_hand_text   ?? {},
            jewelryCartUrl:              settingAttrs.jewelry_cart_url               ?? '',
            mediaVisibility:             settingAttrs.media_visibility               ?? {},
            siteRedirectUrl:             settingAttrs.site_redirect_url              ?? '',
            webGridViewAdPositioning:    settingAttrs.web_grid_view_ad_positioning   ?? '',
            webListViewAdPositioning:    settingAttrs.web_list_view_ad_positioning   ?? '',
            ipadGridViewAdPositioning:   settingAttrs.ipad_grid_view_ad_positioning  ?? '',
            ipadListViewAdPositioning:   settingAttrs.ipad_list_view_ad_positioning  ?? '',
            mobileGridViewAdPositioning: settingAttrs.mobile_grid_view_ad_positioning ?? '',
            mobileListViewAdPositioning: settingAttrs.mobile_list_view_ad_positioning ?? '',
        },

        // ---- meta data (parsed) ----
        metaData: {
            keywords:               metaData.keywords                  ?? '',
            pageTitle:              metaData.page_title                ?? '',
            description:            metaData.description               ?? '',
            websiteVerificationTag: metaData.website_verification_tag  ?? '',
        },

        // ---- additional attributes (parsed) ----
        additionalAttributes: {
            appId:              additionalAttrs.app_id               ?? '',
            apiKey:             additionalAttrs.api_key              ?? '',
            projectId:          additionalAttrs.project_id           ?? '',
            delistDays:         additionalAttrs.delist_days          ?? '',
            remindAfterDays:    additionalAttrs.remind_after_days    ?? '',
            warningAfterDays:   additionalAttrs.warning_after_days   ?? '',
            delistWarningDays:  additionalAttrs.delist_warning_days  ?? '',
            preferredLanguage:  additionalAttrs.preferred_language   ?? '',
            supportedLanguage:  additionalAttrs.supported_language   ?? '',
            retailMarkup:       additionalAttrs.retail_markup        ?? '',
            newArrivalItemTime: additionalAttrs.new_arrival_item_time ?? '',
            apiRequestExpirationDays: additionalAttrs.api_request_expiration_days ?? '',
        },

        // ---- misc top-level fields ----
        analyticId:          raw.analytic_id           ?? '',
        analyticGa4Id:       raw.analytic_ga4_id       ?? '',
        iframKey:            raw.iframe_key             ?? '',
        iframeReferer:       raw.iframe_referer         ?? '',
        iosCert:             raw.ios_cert               ?? '',
        androidCert:         raw.android_cert           ?? '',
        iosCertEnv:          raw.ios_cert_env,
        allowCompanyName:    raw.allow_company_name,
        segmentKey:          raw.segment_key            ?? '',
        spaSegmentKey:       raw.spa_segment_key        ?? '',
        sentryDsn:           raw.sentry_dsn             ?? '',
        mainLogoUrl:         raw.main_logo_url          ?? '',
        menuLogoUrl:         raw.menu_logo_url          ?? '',
        secondaryLogoUrl:    raw.secondary_logo_url     ?? '',
        customCurrencySymbol: raw.custom_currency_symbol ?? '',
        webPluginsScript:    raw.web_plugins_script     ?? '',
        onesignalAppId:      raw.onesignal_app_id       ?? '',
        onesignalRestApiKey: raw.onesignal_rest_api_key ?? '',
        fcmConfig:           raw.fcm_config,
        landingPages:        landingPages,

        // ---- timestamps ----
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
    };

    return organizationData;
}

/**
 * Convenience: returns ONLY the fields that the current test specs
 * (test.spec.js / ORG_Duplicacy.spec.js) actually fill into form fields.
 * Use this when you just need the "form-ready" subset.
 */
export function parseOrgDataForTests(dbJson) {
    const full = parseOrgData(dbJson);

    return {
        name:                     full.name,
        domainUrl:                full.domainUrl,
        status:                   full.status,
        androidAppIdentifier:     full.androidAppIdentifier,
        iosAppIdentifier:         full.iosAppIdentifier,
        apn:                      full.apn,
        ibi:                      full.ibi,
        isi:                      full.isi,
        loginDeeplink:            full.loginDeeplink,
        baseUrl:                  full.baseUrl,
        linkUrl:                  full.linkUrl,
        faviconUrl:               full.faviconUrl,
        iframeStatus:             full.iframeStatus,
        webStatus:                full.webStatus,
        publicKey:                full.publicKey,
        externalLandingPageUrl:   full.externalLandingPageUrl,
        internalLandingPageUrl:   full.internalLandingPageUrl,
        internalLandingPageUrlV3: full.internalLandingPageUrlV3,
        externalLandingPageUrlV3: full.externalLandingPageUrlV3,
        wellknownExternalLanding: full.wellknownExternalLanding,
        wellknownInternalLanding: full.wellknownInternalLanding,
        customHeaderHtml:         full.customHeaderHtml,
        allowDiamonds:            full.allowDiamonds,
        allowGemstones:           full.allowGemstones,
        allowJewelry:             full.allowJewelry,
        allowLabGrownDiamonds:    full.allowLabGrownDiamonds,
        diamondsView:             full.diamondsView,
        gemstonesView:            full.gemstonesView,
        jewelryView:              full.jewelryView,
        businessPlan:             full.businessPlan,
    };
}
