/**
 * Standalone Org Customizations Copy Script
 *
 * Copies all customizations from one org to another:
 *   - PDP, SearchResult, SearchForm, ProductUnifiedPage
 *   - Custom Texts (per language)
 *   - Global
 *   - JsonNavigationMenu
 *
 * Usage:
 *   node scripts/copyOrgCustomizations.js <sourceOrgId> <targetOrgId>
 *
 * Example:
 *   node scripts/copyOrgCustomizations.js 832 945
 */

import { chromium } from '@playwright/test';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

const RESOURCE_TYPE_OVERRIDE = process.env.CUSTOMIZATION_RESOURCE_TYPE?.trim();
const CSRF_PATH_CANDIDATES = [
    '/superadmin/organizations',
    '/superadmin/companies',
    '/superadmin/company_settings',
];

function getAllowedResourceTypesForRead() {
    const types = ['Organization', 'Company'];
    if (RESOURCE_TYPE_OVERRIDE && !types.includes(RESOURCE_TYPE_OVERRIDE)) {
        types.unshift(RESOURCE_TYPE_OVERRIDE);
    }
    return types;
}

function resolveResourceType(defaultType = 'Organization') {
    return RESOURCE_TYPE_OVERRIDE || defaultType;
}

async function fetchCsrfToken(page, baseUrl) {
    const candidatePaths = process.env.CSRF_PAGE_PATH
        ? [process.env.CSRF_PAGE_PATH, ...CSRF_PATH_CANDIDATES]
        : CSRF_PATH_CANDIDATES;

    for (const path of candidatePaths) {
        const url = `${baseUrl}${path}`;
        try {
            await page.goto(url, { waitUntil: 'networkidle' });
            const csrf = await page.evaluate(() =>
                document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
            );
            if (csrf) return { csrf, refererUrl: url };
        } catch {
            // Try next candidate page.
        }
    }

    throw new Error('Could not obtain CSRF token from known admin pages. Set CSRF_PAGE_PATH in .env.');
}

function buildRequestHeaders(baseUrl, csrf, refererUrl) {
    const headers = {
        'x-csrf-token': csrf,
        'x-requested-with': 'XMLHttpRequest',
        'origin': baseUrl,
        'referer': refererUrl || `${baseUrl}/superadmin/organizations`,
    };

    const user = process.env.STAGE_DATA_HTTP_USERNAME;
    const pass = process.env.STAGE_DATA_HTTP_PASSWORD;
    if (user && pass) {
        headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }

    return headers;
}

async function postWithAuth(page, url, options, baseUrl, csrf, refererUrl) {
    return page.request.post(url, {
        ...options,
        maxRedirects: 0,
        headers: buildRequestHeaders(baseUrl, csrf, refererUrl),
    });
}

async function sendCustomizationRequest(page, url, formPayload, multipartPayload, baseUrl, csrf, refererUrl, fallbackFormPayload = null) {
    try {
        const response = await postWithAuth(page, url, { form: formPayload }, baseUrl, csrf, refererUrl);
        const status = response.status();
        if (status === 302 || (status >= 200 && status < 300)) {
            return { ok: true, status, csrf, refererUrl, via: 'form' };
        }
    } catch {
        // Fallback to retry path below.
    }

    try {
        const csrfData = await fetchCsrfToken(page, baseUrl);
        const refreshedCsrf = csrfData.csrf;
        const refreshedReferer = csrfData.refererUrl;
        const response = await postWithAuth(page, url, { multipart: multipartPayload }, baseUrl, refreshedCsrf, refreshedReferer);
        const status = response.status();
        if (status === 302 || (status >= 200 && status < 300)) {
            return { ok: true, status, csrf: refreshedCsrf, refererUrl: refreshedReferer, via: 'multipart' };
        }
        return { ok: false, status, csrf: refreshedCsrf, refererUrl: refreshedReferer, via: 'multipart' };
    } catch (error) {
        if (!fallbackFormPayload) {
            return { ok: false, error, csrf, refererUrl, via: 'multipart' };
        }
    }

    if (!fallbackFormPayload) {
        return { ok: false, csrf, refererUrl, via: 'multipart' };
    }

    try {
        const csrfData = await fetchCsrfToken(page, baseUrl);
        const refreshedCsrf = csrfData.csrf;
        const refreshedReferer = csrfData.refererUrl;
        const fallbackPayload = {
            ...fallbackFormPayload,
            'authenticity_token': refreshedCsrf,
        };
        const response = await postWithAuth(page, url, { form: fallbackPayload }, baseUrl, refreshedCsrf, refreshedReferer);
        const status = response.status();
        if (status === 302 || (status >= 200 && status < 300)) {
            return { ok: true, status, csrf: refreshedCsrf, refererUrl: refreshedReferer, via: 'form-fallback' };
        }
        return { ok: false, status, csrf: refreshedCsrf, refererUrl: refreshedReferer, via: 'form-fallback' };
    } catch (error) {
        return { ok: false, error, csrf, refererUrl, via: 'form-fallback' };
    }
}

const TYPE_CONFIG = {
    'Pdp':                               { path: 'pdps',                  param: 'pdp' },
    'SearchResult':                      { path: 'search_results',        param: 'search_result' },
    'SearchForm':                        { path: 'search_forms',          param: 'search_form' },
    'ProductUnifiedPage':                { path: 'product_unified_pages', param: 'product_unified_page' },
    'Customization::Pdp':                { path: 'pdps',                  param: 'pdp' },
    'Customization::SearchResult':       { path: 'search_results',        param: 'search_result' },
    'Customization::SearchForm':         { path: 'search_forms',          param: 'search_form' },
    'Customization::ProductUnifiedPage': { path: 'product_unified_pages', param: 'product_unified_page' },
};

async function copyOrgCustomizations(sourceOrgId, targetOrgId) {
    log('\n' + '='.repeat(70), 'cyan');
    log('  ORG CUSTOMIZATIONS COPY SCRIPT', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\nSource Org ID: ${sourceOrgId}`, 'yellow');
    log(`Target Org ID: ${targetOrgId}`, 'yellow');
    log(`Base URL: ${process.env.STAGE_BASE_URL}\n`, 'yellow');

    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    let browser;

    try {
        // ── Step 1: Verify both orgs exist ──
        log('Step 1: Verifying organizations...', 'blue');

        const { rows: srcOrg } = await pool.query(
            'SELECT id, name, domain_url FROM organizations WHERE id = $1', [sourceOrgId]
        );
        if (srcOrg.length === 0) throw new Error(`Source org #${sourceOrgId} not found`);
        log(`✓ Source: "${srcOrg[0].name}" (#${srcOrg[0].id})`, 'green');

        const { rows: tgtOrg } = await pool.query(
            'SELECT id, name, domain_url FROM organizations WHERE id = $1', [targetOrgId]
        );
        if (tgtOrg.length === 0) throw new Error(`Target org #${targetOrgId} not found`);
        log(`✓ Target: "${tgtOrg[0].name}" (#${tgtOrg[0].id})`, 'green');

        // ── Step 2: Fetch all data from source org ──
        log('\nStep 2: Fetching data from source org...', 'blue');

        const { rows: customizations } = await pool.query(
            `SELECT id, type, product_type, content, resource_type
             FROM customizations
             WHERE resource_id = $1
             ORDER BY type, product_type`,
            [sourceOrgId]
        );
        log(`  Customizations: ${customizations.length}`, 'cyan');
        for (const c of customizations) {
            log(`    → ${c.type} | product_type=${c.product_type} | id=${c.id}`, 'cyan');
        }

        const resourceTypesForRead = getAllowedResourceTypesForRead();

        const { rows: globals } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE type = 'Global' AND resource_type = ANY($2::text[]) AND resource_id = $1`,
            [sourceOrgId, resourceTypesForRead]
        );
        log(`  Global: ${globals.length > 0 ? `found (id=${globals[0].id})` : 'none'}`, 'cyan');

        const { rows: customTexts } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE resource_id = $1 AND resource_type = ANY($2::text[]) AND language_id IS NOT NULL
             ORDER BY language_id`,
            [sourceOrgId, resourceTypesForRead]
        );
        log(`  Custom Texts: ${customTexts.length}`, 'cyan');
        for (const ct of customTexts) {
            log(`    → language_id=${ct.language_id} | id=${ct.id}`, 'cyan');
        }

        const { rows: navMenuRows } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE type = 'JsonNavigationMenu' AND resource_type = ANY($2::text[]) AND resource_id = $1
             LIMIT 1`,
            [sourceOrgId, resourceTypesForRead]
        );
        const navMenu = navMenuRows[0] || null;
        log(`  Navigation Menu: ${navMenu ? `found (id=${navMenu.id})` : 'none'}`, 'cyan');

        const total = customizations.length + globals.length + customTexts.length + (navMenu ? 1 : 0);
        if (total === 0) {
            log('\n✗ Nothing to copy — source org has no customizations.', 'red');
            return;
        }

        log(`\n  Total items to copy: ${total}`, 'yellow');

        // ── Step 3: Launch browser and login ──
        log('\nStep 3: Launching browser and logging in...', 'blue');
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({
            httpCredentials: {
                username: 'vdborg001',
                password: 'letscreateorgs@078',
            },
        });
        const page = await context.newPage();
        const baseUrl = process.env.STAGE_BASE_URL; 

        await page.goto(`${baseUrl}/superadmin/login`, { waitUntil: 'networkidle' });
        await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
        await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
        await page.getByRole('button', { name: 'Login' }).click();
        await page.waitForLoadState('networkidle');
        log('✓ Logged in successfully', 'green');

        // ── Step 4: Get CSRF token ──
        log('\nStep 4: Fetching CSRF token...', 'blue');
        let { csrf, refererUrl } = await fetchCsrfToken(page, baseUrl);
        log(`✓ CSRF token obtained: ${csrf.substring(0, 20)}...`, 'green');
        log(`✓ CSRF page: ${refererUrl}`, 'green');
        if (RESOURCE_TYPE_OVERRIDE) {
            log(`✓ Resource type override active: ${RESOURCE_TYPE_OVERRIDE}`, 'green');
        }

        // ── Step 5: POST Customizations ──
        let created = 0;
        let updated = 0;
        let failed = 0;

        const { rows: targetCustomizations } = await pool.query(
            `SELECT id, type, product_type
             FROM customizations
             WHERE resource_id = $1`,
            [targetOrgId]
        );
        const targetCustomizationMap = new Map(
            targetCustomizations.map((row) => [`${row.type}::${String(row.product_type)}`, row.id])
        );

        const { rows: targetGlobals } = await pool.query(
            `SELECT id FROM custom_texts
             WHERE type = 'Global' AND resource_type = ANY($2::text[]) AND resource_id = $1
             ORDER BY id DESC
             LIMIT 1`,
            [targetOrgId, resourceTypesForRead]
        );
        const targetGlobalId = targetGlobals[0]?.id || null;

        const { rows: targetCustomTexts } = await pool.query(
            `SELECT id, language_id
             FROM custom_texts
             WHERE resource_id = $1 AND resource_type = ANY($2::text[]) AND language_id IS NOT NULL`,
            [targetOrgId, resourceTypesForRead]
        );
        const targetCustomTextMap = new Map(
            targetCustomTexts.map((row) => [String(row.language_id), row.id])
        );

        const { rows: targetNavMenuRows } = await pool.query(
            `SELECT id FROM custom_texts
             WHERE type = 'JsonNavigationMenu' AND resource_type = ANY($2::text[]) AND resource_id = $1
             ORDER BY id DESC
             LIMIT 1`,
            [targetOrgId, resourceTypesForRead]
        );
        const targetNavMenuId = targetNavMenuRows[0]?.id || null;

        if (customizations.length > 0) {
            log('\nStep 5: Posting customizations...', 'blue');
            log('-'.repeat(70), 'cyan');

            for (const c of customizations) {
                const config = TYPE_CONFIG[c.type];
                if (!config) {
                    log(`  ✗ Unknown type "${c.type}" — skipping`, 'red');
                    failed++;
                    continue;
                }

                const contentStr = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
                const resourceType = resolveResourceType(c.resource_type || 'Organization');
                const productType = String(c.product_type);
                const existingId = targetCustomizationMap.get(`${c.type}::${productType}`);
                const isUpdate = Boolean(existingId);
                const url = isUpdate
                    ? `${baseUrl}/superadmin/${config.path}/${existingId}`
                    : `${baseUrl}/superadmin/${config.path}`;

                log(`\n→ ${c.type} | product_type=${productType} | ${isUpdate ? `update id=${existingId}` : 'create'} | ${contentStr.length} chars`, 'yellow');

                const methodField = isUpdate ? { '_method': 'patch' } : {};
                const formPayload = {
                    'utf8': '✓',
                    'authenticity_token': csrf,
                    ...methodField,
                    [`${config.param}[resource_id]`]: String(targetOrgId),
                    [`${config.param}[resource_type]`]: resourceType,
                    [`${config.param}[product_type]`]: productType,
                    [`${config.param}[content]`]: contentStr,
                };
                const multipartPayload = {
                    ...formPayload,
                };

                const result = await sendCustomizationRequest(
                    page,
                    url,
                    formPayload,
                    multipartPayload,
                    baseUrl,
                    csrf,
                    refererUrl
                );
                csrf = result.csrf;
                refererUrl = result.refererUrl;

                if (result.ok) {
                    log(`  ✓ ${isUpdate ? 'Updated' : 'Created'} (${result.status})${result.via === 'multipart' ? ' via multipart' : ''}`, 'green');
                    if (isUpdate) {
                        updated++;
                    } else {
                        created++;
                    }
                } else {
                    if (result.error) {
                        log(`  ✗ ERROR: ${result.error.message}`, 'red');
                    } else {
                        log(`  ✗ FAIL (${result.status})`, 'red');
                    }
                    failed++;
                }
            }
        }

        // ── Step 6: POST JsonNavigationMenu ──
        if (navMenu) {
            log('\nStep 6: Posting JsonNavigationMenu...', 'blue');
            const contentStr = typeof navMenu.content === 'string' ? navMenu.content : JSON.stringify(navMenu.content);
            log(`→ NavMenu | ${contentStr.length} chars`, 'yellow');

            const navIsUpdate = Boolean(targetNavMenuId);
            const navUrl = navIsUpdate
                ? `${baseUrl}/superadmin/json_navigation_menus/${targetNavMenuId}`
                : `${baseUrl}/superadmin/json_navigation_menus`;
            const navFormPayload = {
                'utf8': '✓',
                'authenticity_token': csrf,
                ...(navIsUpdate ? { '_method': 'patch' } : {}),
                'json_navigation_menu[resource_type]': resolveResourceType('Organization'),
                'json_navigation_menu[resource_id]': String(targetOrgId),
                'json_navigation_menu[content]': contentStr,
                'commit': navIsUpdate ? 'Update Json navigation menu' : 'Create Json navigation menu',
            };
            const navResult = await sendCustomizationRequest(
                page,
                navUrl,
                navFormPayload,
                navFormPayload,
                baseUrl,
                csrf,
                refererUrl
            );
            csrf = navResult.csrf;
            refererUrl = navResult.refererUrl;

            if (navResult.ok) {
                log(`  ✓ ${navIsUpdate ? 'Updated' : 'Created'} (${navResult.status})${navResult.via === 'multipart' ? ' via multipart' : ''}`, 'green');
                if (navIsUpdate) {
                    updated++;
                } else {
                    created++;
                }
            } else {
                log(`  ✗ ${navResult.error ? `ERROR: ${navResult.error.message}` : `FAIL (${navResult.status})`}`, 'red');
                failed++;
            }
        } else {
            log('\nStep 6: No JsonNavigationMenu — skipping', 'yellow');
        }

        // ── Step 7: POST Global ──
        if (globals.length > 0) {
            log('\nStep 7: Posting Global...', 'blue');
            const g = globals[0];
            const contentStr = typeof g.content === 'string' ? g.content : JSON.stringify(g.content);
            log(`→ Global (id=${g.id}) | ${contentStr.length} chars`, 'yellow');

            const globalIsUpdate = Boolean(targetGlobalId);
            const globalUrl = globalIsUpdate
                ? `${baseUrl}/superadmin/globals/${targetGlobalId}`
                : `${baseUrl}/superadmin/globals`;
            const globalPayload = {
                'utf8': '✓',
                'authenticity_token': csrf,
                ...(globalIsUpdate ? { '_method': 'patch' } : {}),
                'global[resource_type]': resolveResourceType('Organization'),
                'global[resource_id]': String(targetOrgId),
                'global[content]': contentStr,
            };
            const globalFallbackPayload = globalIsUpdate
                ? {
                    'utf8': '✓',
                    'global[resource_type]': resolveResourceType('Organization'),
                    'global[resource_id]': String(targetOrgId),
                    'global[content]': contentStr,
                }
                : null;
            const globalResult = await sendCustomizationRequest(
                page,
                globalUrl,
                globalPayload,
                globalPayload,
                baseUrl,
                csrf,
                refererUrl,
                globalFallbackPayload
            );
            csrf = globalResult.csrf;
            refererUrl = globalResult.refererUrl;

            if (globalResult.ok) {
                log(`  ✓ ${globalIsUpdate ? 'Updated' : 'Created'} (${globalResult.status})${globalResult.via === 'multipart' ? ' via multipart' : ''}`, 'green');
                if (globalIsUpdate) {
                    updated++;
                } else {
                    created++;
                }
            } else {
                log(`  ✗ ${globalResult.error ? `ERROR: ${globalResult.error.message}` : `FAIL (${globalResult.status})`}`, 'red');
                failed++;
            }
        } else {
            log('\nStep 7: No Global — skipping', 'yellow');
        }

        // ── Step 8: POST Custom Texts ──
        if (customTexts.length > 0) {
            log('\nStep 8: Posting Custom Texts...', 'blue');
            log('-'.repeat(70), 'cyan');

            for (const ct of customTexts) {
                const contentStr = typeof ct.content === 'string' ? ct.content : JSON.stringify(ct.content);
                const langId = String(ct.language_id);
                log(`\n→ Custom Text | language_id=${langId} | ${contentStr.length} chars`, 'yellow');

                const existingCustomTextId = targetCustomTextMap.get(langId);
                const customTextIsUpdate = Boolean(existingCustomTextId);
                const customTextUrl = customTextIsUpdate
                    ? `${baseUrl}/superadmin/custom_texts/${existingCustomTextId}`
                    : `${baseUrl}/superadmin/custom_texts`;
                const customTextPayload = {
                    'utf8': '✓',
                    'authenticity_token': csrf,
                    ...(customTextIsUpdate ? { '_method': 'patch' } : {}),
                    'custom_text[resource_type]': resolveResourceType('Organization'),
                    'custom_text[resource_id]': String(targetOrgId),
                    'custom_text[language_id]': langId,
                    'custom_text[content]': contentStr,
                };
                const customTextFallbackPayload = customTextIsUpdate
                    ? {
                        'utf8': '✓',
                        'custom_text[resource_type]': resolveResourceType('Organization'),
                        'custom_text[resource_id]': String(targetOrgId),
                        'custom_text[language_id]': langId,
                        'custom_text[content]': contentStr,
                    }
                    : null;
                const customTextResult = await sendCustomizationRequest(
                    page,
                    customTextUrl,
                    customTextPayload,
                    customTextPayload,
                    baseUrl,
                    csrf,
                    refererUrl,
                    customTextFallbackPayload
                );
                csrf = customTextResult.csrf;
                refererUrl = customTextResult.refererUrl;

                if (customTextResult.ok) {
                    log(`  ✓ ${customTextIsUpdate ? 'Updated' : 'Created'} (${customTextResult.status})${customTextResult.via === 'multipart' ? ' via multipart' : ''}`, 'green');
                    if (customTextIsUpdate) {
                        updated++;
                    } else {
                        created++;
                    }
                } else {
                    log(`  ✗ ${customTextResult.error ? `ERROR: ${customTextResult.error.message}` : `FAIL (${customTextResult.status})`}`, 'red');
                    failed++;
                }
            }
        } else {
            log('\nStep 8: No Custom Texts — skipping', 'yellow');
        }

        // ── Summary ──
        log('\n' + '='.repeat(70), 'cyan');
        log('  COPY SUMMARY', 'bright');
        log('='.repeat(70), 'cyan');
        log(`Source Org: "${srcOrg[0].name}" (#${sourceOrgId})`, 'yellow');
        log(`Target Org: "${tgtOrg[0].name}" (#${targetOrgId})`, 'yellow');
        log(`Total Items: ${total}`, 'yellow');
        log(`✓ Created: ${created}`, 'green');
        log(`↻ Updated: ${updated}`, 'green');
        log(`✗ Failed:  ${failed}`, failed > 0 ? 'red' : 'green');
        log(`Success Rate: ${(((created + updated) / total) * 100).toFixed(1)}%`, 'magenta');
        log('='.repeat(70) + '\n', 'cyan');

    } catch (error) {
        log(`\n✗ Fatal Error: ${error.message}`, 'red');
        console.error(error);
    } finally {
        await pool.end();
        if (browser) await browser.close();
    }
}

// ── Main ──
const args = process.argv.slice(2);

if (args.length < 2) {
    log('\n✗ Error: Missing required arguments', 'red');
    log('\nUsage:', 'yellow');
    log('  node scripts/copyOrgCustomizations.js <sourceOrgId> <targetOrgId>', 'cyan');
    log('\nExample:', 'yellow');
    log('  node scripts/copyOrgCustomizations.js 832 945', 'cyan');
    log('\nWhat it copies:', 'yellow');
    log('  • Customizations (PDP, SearchResult, SearchForm, ProductUnifiedPage)', 'cyan');
    log('  • Custom Texts (per language)', 'cyan');
    log('  • Global', 'cyan');
    log('  • JsonNavigationMenu', 'cyan');
    process.exit(1);
}

const [sourceOrgId, targetOrgId] = args.map(Number);

if (isNaN(sourceOrgId) || isNaN(targetOrgId)) {
    log('\n✗ Error: Org IDs must be numbers', 'red');
    process.exit(1);
}

if (sourceOrgId === targetOrgId) {
    log('\n✗ Error: Source and target org cannot be the same', 'red');
    process.exit(1);
}

copyOrgCustomizations(sourceOrgId, targetOrgId)
    .then(() => {
        log('✓ Script completed successfully\n', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n✗ Script failed: ${error.message}\n`, 'red');
        process.exit(1);
    });
