/**
 * Standalone Company Customizations Copy Script
 *
 * Copies all customizations from one company to another:
 *   - PDP, SearchResult, SearchForm, ProductUnifiedPage
 *   - Custom Texts (per language)
 *   - Global
 *   - JsonNavigationMenu
 *
 * Usage:
 *   node scripts/copyCompanyCustomizations.js <sourceCompanyId> <targetCompanyId>
 *
 * Example:
 *   node scripts/copyCompanyCustomizations.js 832 945
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

async function copyCompanyCustomizations(sourceCompanyId, targetCompanyId) {
    log('\n' + '='.repeat(70), 'cyan');
    log('  COMPANY CUSTOMIZATIONS COPY SCRIPT', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\nSource Company ID: ${sourceCompanyId}`, 'yellow');
    log(`Target Company ID: ${targetCompanyId}`, 'yellow');
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
        // ── Step 1: Verify both companies exist ──
        log('Step 1: Verifying companies...', 'blue');

        const { rows: srcCompany } = await pool.query(
            'SELECT id, name FROM companies WHERE id = $1', [sourceCompanyId]
        );
        if (srcCompany.length === 0) throw new Error(`Source company #${sourceCompanyId} not found`);
        log(`✓ Source: "${srcCompany[0].name}" (#${srcCompany[0].id})`, 'green');

        const { rows: tgtCompany } = await pool.query(
            'SELECT id, name FROM companies WHERE id = $1', [targetCompanyId]
        );
        if (tgtCompany.length === 0) throw new Error(`Target company #${targetCompanyId} not found`);
        log(`✓ Target: "${tgtCompany[0].name}" (#${tgtCompany[0].id})`, 'green');

        // ── Step 2: Fetch all data from source company ──
        log('\nStep 2: Fetching data from source company...', 'blue');

        const { rows: customizations } = await pool.query(
            `SELECT id, type, product_type, content, resource_type
             FROM customizations
             WHERE resource_id = $1
             ORDER BY type, product_type`,
            [sourceCompanyId]
        );
        log(`  Customizations: ${customizations.length}`, 'cyan');
        for (const c of customizations) {
            log(`    → ${c.type} | product_type=${c.product_type} | id=${c.id}`, 'cyan');
        }

        const resourceTypesForRead = getAllowedResourceTypesForRead();

        const { rows: globals } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE type = 'Global' AND resource_type = ANY($2::text[]) AND resource_id = $1`,
            [sourceCompanyId, resourceTypesForRead]
        );
        log(`  Global: ${globals.length > 0 ? `found (id=${globals[0].id})` : 'none'}`, 'cyan');

        const { rows: customTexts } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE resource_id = $1 AND resource_type = ANY($2::text[]) AND language_id IS NOT NULL
             ORDER BY language_id`,
            [sourceCompanyId, resourceTypesForRead]
        );
        log(`  Custom Texts: ${customTexts.length}`, 'cyan');
        for (const ct of customTexts) {
            log(`    → language_id=${ct.language_id} | id=${ct.id}`, 'cyan');
        }

        const { rows: navMenuRows } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE type = 'JsonNavigationMenu' AND resource_type = ANY($2::text[]) AND resource_id = $1
             LIMIT 1`,
            [sourceCompanyId, resourceTypesForRead]
        );
        const navMenu = navMenuRows[0] || null;
        log(`  Navigation Menu: ${navMenu ? `found (id=${navMenu.id})` : 'none'}`, 'cyan');

        const total = customizations.length + globals.length + customTexts.length + (navMenu ? 1 : 0);
        if (total === 0) {
            log('\n✗ Nothing to copy — source company has no customizations.', 'red');
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
        let failed = 0;

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
                const resourceType = resolveResourceType(c.resource_type || 'Company');
                const productType = String(c.product_type);
                const url = `${baseUrl}/superadmin/${config.path}`;

                log(`\n→ ${c.type} | product_type=${productType} | ${contentStr.length} chars`, 'yellow');

                let ok = false;

                // Attempt 1: form-encoded POST
                try {
                    const response = await postWithAuth(page, url, {
                        form: {
                            'utf8': '✓',
                            'authenticity_token': csrf,
                            [`${config.param}[resource_id]`]: String(targetCompanyId),
                            [`${config.param}[resource_type]`]: resourceType,
                            [`${config.param}[product_type]`]: productType,
                            [`${config.param}[content]`]: contentStr,
                        },
                    }, baseUrl, csrf, refererUrl);
                    const status = response.status();
                    if (status === 302 || (status >= 200 && status < 300)) {
                        log(`  ✓ OK (${status})`, 'green');
                        ok = true;
                        created++;
                    } else {
                        log(`  ✗ FAIL (${status}) — retrying with multipart...`, 'red');
                    }
                } catch (err) {
                    log(`  ✗ ERROR: ${err.message} — retrying...`, 'red');
                }

                // Attempt 2: multipart POST with fresh CSRF
                if (!ok) {
                    try {
                        const csrfData = await fetchCsrfToken(page, baseUrl);
                        csrf = csrfData.csrf;
                        refererUrl = csrfData.refererUrl;

                        const response = await postWithAuth(page, url, {
                            multipart: {
                                'utf8': '✓',
                                'authenticity_token': csrf,
                                [`${config.param}[resource_id]`]: String(targetCompanyId),
                                [`${config.param}[resource_type]`]: resourceType,
                                [`${config.param}[product_type]`]: productType,
                                [`${config.param}[content]`]: contentStr,
                            },
                        }, baseUrl, csrf, refererUrl);
                        const status = response.status();
                        if (status === 302 || (status >= 200 && status < 300)) {
                            log(`  ✓ OK via multipart (${status})`, 'green');
                            ok = true;
                            created++;
                        } else {
                            log(`  ✗ Multipart also failed (${status})`, 'red');
                        }
                    } catch (err) {
                        log(`  ✗ Multipart error: ${err.message}`, 'red');
                    }
                }

                if (!ok) failed++;
            }
        }

        // ── Step 6: POST JsonNavigationMenu ──
        if (navMenu) {
            log('\nStep 6: Posting JsonNavigationMenu...', 'blue');
            const contentStr = typeof navMenu.content === 'string' ? navMenu.content : JSON.stringify(navMenu.content);
            log(`→ NavMenu | ${contentStr.length} chars`, 'yellow');

            let ok = false;
            try {
                const response = await postWithAuth(page, `${baseUrl}/superadmin/json_navigation_menus`, {
                    form: {
                        'utf8': '✓',
                        'authenticity_token': csrf,
                        'json_navigation_menu[resource_type]': resolveResourceType('Company'),
                        'json_navigation_menu[resource_id]': String(targetCompanyId),
                        'json_navigation_menu[content]': contentStr,
                        'commit': 'Create Json navigation menu',
                    },
                }, baseUrl, csrf, refererUrl);
                const status = response.status();
                if (status === 302 || (status >= 200 && status < 300)) {
                    log(`  ✓ OK (${status})`, 'green');
                    ok = true;
                    created++;
                } else {
                    log(`  ✗ FAIL (${status}) — retrying with fresh CSRF...`, 'red');
                }
            } catch (err) {
                log(`  ✗ ERROR: ${err.message} — retrying...`, 'red');
            }

            if (!ok) {
                try {
                    const csrfData = await fetchCsrfToken(page, baseUrl);
                    csrf = csrfData.csrf;
                    refererUrl = csrfData.refererUrl;

                    const response = await postWithAuth(page, `${baseUrl}/superadmin/json_navigation_menus`, {
                        form: {
                            'utf8': '✓',
                            'authenticity_token': csrf,
                            'json_navigation_menu[resource_type]': resolveResourceType('Company'),
                            'json_navigation_menu[resource_id]': String(targetCompanyId),
                            'json_navigation_menu[content]': contentStr,
                            'commit': 'Create Json navigation menu',
                        },
                    }, baseUrl, csrf, refererUrl);
                    const status = response.status();
                    if (status === 302 || (status >= 200 && status < 300)) {
                        log(`  ✓ OK on retry (${status})`, 'green');
                        ok = true;
                        created++;
                    } else {
                        log(`  ✗ Retry also failed (${status})`, 'red');
                    }
                } catch (err) {
                    log(`  ✗ Retry error: ${err.message}`, 'red');
                }
            }

            if (!ok) failed++;
        } else {
            log('\nStep 6: No JsonNavigationMenu — skipping', 'yellow');
        }

        // ── Step 7: POST Global ──
        if (globals.length > 0) {
            log('\nStep 7: Posting Global...', 'blue');
            const g = globals[0];
            const contentStr = typeof g.content === 'string' ? g.content : JSON.stringify(g.content);
            log(`→ Global (id=${g.id}) | ${contentStr.length} chars`, 'yellow');

            try {
                const response = await postWithAuth(page, `${baseUrl}/superadmin/globals`, {
                    form: {
                        'utf8': '✓',
                        'authenticity_token': csrf,
                        'global[resource_type]': resolveResourceType('Company'),
                        'global[resource_id]': String(targetCompanyId),
                        'global[content]': contentStr,
                    },
                }, baseUrl, csrf, refererUrl);
                const status = response.status();
                if (status === 302 || (status >= 200 && status < 300)) {
                    log(`  ✓ OK (${status})`, 'green');
                    created++;
                } else {
                    log(`  ✗ FAIL (${status})`, 'red');
                    failed++;
                }
            } catch (err) {
                log(`  ✗ ERROR: ${err.message}`, 'red');
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

                try {
                    const response = await postWithAuth(page, `${baseUrl}/superadmin/custom_texts`, {
                        form: {
                            'utf8': '✓',
                            'authenticity_token': csrf,
                            'custom_text[resource_type]': resolveResourceType('Company'),
                            'custom_text[resource_id]': String(targetCompanyId),
                            'custom_text[language_id]': langId,
                            'custom_text[content]': contentStr,
                        },
                    }, baseUrl, csrf, refererUrl);
                    const status = response.status();
                    if (status === 302 || (status >= 200 && status < 300)) {
                        log(`  ✓ OK (${status})`, 'green');
                        created++;
                    } else {
                        log(`  ✗ FAIL (${status})`, 'red');
                        failed++;
                    }
                } catch (err) {
                    log(`  ✗ ERROR: ${err.message}`, 'red');
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
        log(`Source Company: "${srcCompany[0].name}" (#${sourceCompanyId})`, 'yellow');
        log(`Target Company: "${tgtCompany[0].name}" (#${targetCompanyId})`, 'yellow');
        log(`Total Items: ${total}`, 'yellow');
        log(`✓ Created: ${created}`, 'green');
        log(`✗ Failed:  ${failed}`, failed > 0 ? 'red' : 'green');
        log(`Success Rate: ${((created / total) * 100).toFixed(1)}%`, 'magenta');
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
    log('  node scripts/copyCompanyCustomizations.js <sourceCompanyId> <targetCompanyId>', 'cyan');
    log('\nExample:', 'yellow');
    log('  node scripts/copyCompanyCustomizations.js 832 945', 'cyan');
    log('\nWhat it copies:', 'yellow');
    log('  • Customizations (PDP, SearchResult, SearchForm, ProductUnifiedPage)', 'cyan');
    log('  • Custom Texts (per language)', 'cyan');
    log('  • Global', 'cyan');
    log('  • JsonNavigationMenu', 'cyan');
    process.exit(1);
}

const [sourceCompanyId, targetCompanyId] = args.map(Number);

if (isNaN(sourceCompanyId) || isNaN(targetCompanyId)) {
    log('\n✗ Error: Company IDs must be numbers', 'red');
    process.exit(1);
}

if (sourceCompanyId === targetCompanyId) {
    log('\n✗ Error: Source and target company cannot be the same', 'red');
    process.exit(1);
}

copyCompanyCustomizations(sourceCompanyId, targetCompanyId)
    .then(() => {
        log('✓ Script completed successfully\n', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n✗ Script failed: ${error.message}\n`, 'red');
        process.exit(1);
    });
