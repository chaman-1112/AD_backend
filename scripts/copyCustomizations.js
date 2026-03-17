/**
 * Unified Customizations Copy Script (Org + Company)
 *
 * Supports:
 *   - Organization to Organization copy
 *   - Company to Company copy
 *
 * Usage:
 *   node scripts/copyCustomizations.js <org|company> <sourceId> <targetId>
 *
 * Examples:
 *   node scripts/copyCustomizations.js org 832 945
 *   node scripts/copyCustomizations.js company 101 202
 */

import { chromium } from '@playwright/test';
import pg from 'pg';
import dotenv from 'dotenv';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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

const ENTITY_CONFIG = {
    org: {
        label: 'Org',
        pluralLabel: 'organizations',
        table: 'organizations',
        defaultResourceType: 'Organization',
    },
    company: {
        label: 'Company',
        pluralLabel: 'companies',
        table: 'companies',
        defaultResourceType: 'Company',
    },
};

const TYPE_CONFIG = {
    'Pdp': { path: 'pdps', param: 'pdp' },
    'SearchResult': { path: 'search_results', param: 'search_result' },
    'SearchForm': { path: 'search_forms', param: 'search_form' },
    'ProductUnifiedPage': { path: 'product_unified_pages', param: 'product_unified_page' },
    'Customization::Pdp': { path: 'pdps', param: 'pdp' },
    'Customization::SearchResult': { path: 'search_results', param: 'search_result' },
    'Customization::SearchForm': { path: 'search_forms', param: 'search_form' },
    'Customization::ProductUnifiedPage': { path: 'product_unified_pages', param: 'product_unified_page' },
};

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
        origin: baseUrl,
        referer: refererUrl || `${baseUrl}/superadmin/organizations`,
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

async function sendCustomizationRequest(
    page,
    url,
    formPayload,
    multipartPayload,
    baseUrl,
    csrf,
    refererUrl,
    fallbackFormPayload = null
) {
    try {
        const response = await postWithAuth(page, url, { form: formPayload }, baseUrl, csrf, refererUrl);
        const status = response.status();
        if (status === 302 || (status >= 200 && status < 300)) {
            return { ok: true, status, csrf, refererUrl, via: 'form' };
        }
    } catch {
        // Fallback below.
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
            authenticity_token: refreshedCsrf,
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

function parseSelection(inputText, totalCount) {
    const normalized = inputText.trim().toLowerCase();
    if (!normalized || normalized === 'all') {
        return new Set(Array.from({ length: totalCount }, (_, idx) => idx + 1));
    }
    if (normalized === 'none') {
        return new Set();
    }

    const selected = new Set();
    const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
        if (part.includes('-')) {
            const [startStr, endStr] = part.split('-').map((x) => x.trim());
            const start = Number(startStr);
            const end = Number(endStr);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1 || start > totalCount || end > totalCount) {
                throw new Error(`Invalid range: "${part}"`);
            }
            const min = Math.min(start, end);
            const max = Math.max(start, end);
            for (let i = min; i <= max; i++) selected.add(i);
            continue;
        }

        const index = Number(part);
        if (!Number.isInteger(index) || index < 1 || index > totalCount) {
            throw new Error(`Invalid number: "${part}"`);
        }
        selected.add(index);
    }

    return selected;
}

async function promptItemSelection(rl, title, entries) {
    if (entries.length === 0) return [];

    log(`\n${title}`, 'blue');
    for (let i = 0; i < entries.length; i++) {
        log(`  [ ] ${i + 1}. ${entries[i].label}`, 'cyan');
    }

    while (true) {
        const inputText = await rl.question('Select items (comma/range, "all", "none") [default: all]: ');
        try {
            const chosen = parseSelection(inputText, entries.length);
            const selectedEntries = entries.filter((_, idx) => chosen.has(idx + 1));
            log(`  Selected: ${selectedEntries.length}/${entries.length}`, 'yellow');
            return selectedEntries;
        } catch (error) {
            log(`  ✗ ${error.message}. Try again.`, 'red');
        }
    }
}

function parseCopySections(sectionListText) {
    if (!sectionListText) return new Set();
    const map = {
        global: 'global',
        globals: 'global',
        custom_texts: 'custom_texts',
        customtexts: 'custom_texts',
        custom_text: 'custom_texts',
        json_navigation_menu: 'json_navigation_menu',
        jsonnavigationmenu: 'json_navigation_menu',
        navmenu: 'json_navigation_menu',
    };
    return new Set(
        String(sectionListText)
            .split(',')
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean)
            .map((part) => map[part] || part)
            .filter((part) => part === 'global' || part === 'custom_texts' || part === 'json_navigation_menu')
    );
}

export async function copyCustomizations(entityType, sourceId, targetId, options = {}) {
    const entity = ENTITY_CONFIG[entityType];
    if (!entity) {
        throw new Error(`Invalid entity type "${entityType}". Use "org" or "company".`);
    }

    log('\n' + '='.repeat(70), 'cyan');
    log(`  ${entity.label.toUpperCase()} CUSTOMIZATIONS COPY SCRIPT`, 'bright');
    log('='.repeat(70), 'cyan');
    log(`\nSource ${entity.label} ID: ${sourceId}`, 'yellow');
    log(`Target ${entity.label} ID: ${targetId}`, 'yellow');
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
    const isInteractive = !options.nonInteractive && process.stdin.isTTY && process.stdout.isTTY;
    const rl = isInteractive ? readline.createInterface({ input, output }) : null;

    try {
        // Step 1: verify source + target
        log(`Step 1: Verifying ${entity.pluralLabel}...`, 'blue');
        const verifyQuery = `SELECT id, name FROM ${entity.table} WHERE id = $1`;
        const { rows: srcRows } = await pool.query(verifyQuery, [sourceId]);
        if (srcRows.length === 0) throw new Error(`Source ${entity.label.toLowerCase()} #${sourceId} not found`);
        log(`✓ Source: "${srcRows[0].name}" (#${srcRows[0].id})`, 'green');

        const { rows: tgtRows } = await pool.query(verifyQuery, [targetId]);
        if (tgtRows.length === 0) throw new Error(`Target ${entity.label.toLowerCase()} #${targetId} not found`);
        log(`✓ Target: "${tgtRows[0].name}" (#${tgtRows[0].id})`, 'green');

        // Step 2: fetch source data
        log(`\nStep 2: Fetching data from source ${entity.label.toLowerCase()}...`, 'blue');
        const { rows: customizations } = await pool.query(
            `SELECT id, type, product_type, content, resource_type
             FROM customizations
             WHERE resource_id = $1
             ORDER BY type, product_type`,
            [sourceId]
        );
        const resourceTypesForRead = getAllowedResourceTypesForRead();

        const { rows: globals } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE type = 'Global' AND resource_type = ANY($2::text[]) AND resource_id = $1`,
            [sourceId, resourceTypesForRead]
        );

        const { rows: customTexts } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE resource_id = $1 AND resource_type = ANY($2::text[]) AND language_id IS NOT NULL
             ORDER BY language_id`,
            [sourceId, resourceTypesForRead]
        );

        const { rows: navMenuRows } = await pool.query(
            `SELECT * FROM custom_texts
             WHERE type = 'JsonNavigationMenu' AND resource_type = ANY($2::text[]) AND resource_id = $1
             LIMIT 1`,
            [sourceId, resourceTypesForRead]
        );
        const navMenu = navMenuRows[0] || null;

        // Step 3: item selection
        const sectionFilter = parseCopySections(options.copySections || '');
        const isFilteredRun = sectionFilter.size > 0;
        const customizationEntries = isFilteredRun
            ? []
            : customizations.map((row) => ({
                row,
                label: `${row.type} | product_type=${row.product_type} | id=${row.id}`,
            }));

        if (isFilteredRun) {
            log(`\nStep 3: Applying section filter: ${[...sectionFilter].join(', ')}`, 'blue');
            log('Step 3: Customizations (PDP/SearchResult/SearchForm/...) are skipped for filtered runs.', 'yellow');
        } else {
            log('\nStep 3: Select what to copy (checkbox-style)', 'blue');
        }

        const globalEntries = isFilteredRun
            ? (sectionFilter.has('global')
                ? globals.slice(0, 1).map((row) => ({ row, label: `Global | id=${row.id}` }))
                : [])
            : globals.slice(0, 1).map((row) => ({ row, label: `Global | id=${row.id}` }));
        const navEntries = isFilteredRun
            ? (sectionFilter.has('json_navigation_menu')
                ? (navMenu ? [{ row: navMenu, label: `JsonNavigationMenu | id=${navMenu.id}` }] : [])
                : [])
            : (navMenu ? [{ row: navMenu, label: `JsonNavigationMenu | id=${navMenu.id}` }] : []);
        const customTextEntries = isFilteredRun
            ? (sectionFilter.has('custom_texts')
                ? customTexts.map((row) => ({ row, label: `language_id=${row.language_id} | id=${row.id}` }))
                : [])
            : customTexts.map((row) => ({ row, label: `language_id=${row.language_id} | id=${row.id}` }));

        const customizationSelections = isInteractive
            ? await promptItemSelection(rl, 'Customizations:', customizationEntries)
            : customizationEntries;
        const globalSelections = isInteractive
            ? await promptItemSelection(rl, 'Global:', globalEntries)
            : globalEntries;
        const navSelections = isInteractive
            ? await promptItemSelection(rl, 'JsonNavigationMenu:', navEntries)
            : navEntries;
        const customTextSelections = isInteractive
            ? await promptItemSelection(rl, 'Custom Texts:', customTextEntries)
            : customTextEntries;

        const selectedCustomizations = customizationSelections.map((x) => x.row);
        const selectedGlobals = globalSelections.map((x) => x.row);
        const selectedNavMenu = navSelections.length > 0 ? navSelections[0].row : null;
        const selectedCustomTexts = customTextSelections.map((x) => x.row);
        const totalToCopy =
            selectedCustomizations.length +
            selectedGlobals.length +
            selectedCustomTexts.length +
            (selectedNavMenu ? 1 : 0);

        if (totalToCopy === 0) {
            log('\n✗ Nothing selected — exiting.', 'red');
            return;
        }
        log(`\nSelected total items: ${totalToCopy}`, 'yellow');

        // Step 4: login
        log('\nStep 4: Launching browser and logging in...', 'blue');
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({
            httpCredentials: {
                username: process.env.STAGE_DATA_HTTP_USERNAME || 'vdborg001',
                password: process.env.STAGE_DATA_HTTP_PASSWORD || 'letscreateorgs@078',
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

        // Step 5: csrf + target existing lookup
        log('\nStep 5: Fetching CSRF token and target state...', 'blue');
        let { csrf, refererUrl } = await fetchCsrfToken(page, baseUrl);
        log(`✓ CSRF token obtained: ${csrf.substring(0, 20)}...`, 'green');

        const { rows: targetCustomizations } = await pool.query(
            `SELECT id, type, product_type
             FROM customizations
             WHERE resource_id = $1`,
            [targetId]
        );
        const targetCustomizationMap = new Map(
            targetCustomizations.map((row) => [`${row.type}::${String(row.product_type)}`, row.id])
        );

        const { rows: targetGlobals } = await pool.query(
            `SELECT id FROM custom_texts
             WHERE type = 'Global' AND resource_type = ANY($2::text[]) AND resource_id = $1
             ORDER BY id DESC
             LIMIT 1`,
            [targetId, resourceTypesForRead]
        );
        const targetGlobalId = targetGlobals[0]?.id || null;

        const { rows: targetCustomTexts } = await pool.query(
            `SELECT id, language_id
             FROM custom_texts
             WHERE resource_id = $1 AND resource_type = ANY($2::text[]) AND language_id IS NOT NULL`,
            [targetId, resourceTypesForRead]
        );
        const targetCustomTextMap = new Map(
            targetCustomTexts.map((row) => [String(row.language_id), row.id])
        );

        const { rows: targetNavMenuRows } = await pool.query(
            `SELECT id FROM custom_texts
             WHERE type = 'JsonNavigationMenu' AND resource_type = ANY($2::text[]) AND resource_id = $1
             ORDER BY id DESC
             LIMIT 1`,
            [targetId, resourceTypesForRead]
        );
        const targetNavMenuId = targetNavMenuRows[0]?.id || null;

        // Step 6+: copy selected data
        let created = 0;
        let updated = 0;
        let failed = 0;

        if (selectedCustomizations.length > 0) {
            log('\nStep 6: Posting selected customizations...', 'blue');
            log('-'.repeat(70), 'cyan');

            for (const c of selectedCustomizations) {
                const config = TYPE_CONFIG[c.type];
                if (!config) {
                    log(`  ✗ Unknown type "${c.type}" — skipping`, 'red');
                    failed++;
                    continue;
                }

                const contentStr = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
                const resourceType = resolveResourceType(c.resource_type || entity.defaultResourceType);
                const productType = String(c.product_type);
                const existingId = targetCustomizationMap.get(`${c.type}::${productType}`);
                const isUpdate = Boolean(existingId);
                const url = isUpdate
                    ? `${baseUrl}/superadmin/${config.path}/${existingId}`
                    : `${baseUrl}/superadmin/${config.path}`;

                const formPayload = {
                    utf8: '✓',
                    authenticity_token: csrf,
                    ...(isUpdate ? { _method: 'patch' } : {}),
                    [`${config.param}[resource_id]`]: String(targetId),
                    [`${config.param}[resource_type]`]: resourceType,
                    [`${config.param}[product_type]`]: productType,
                    [`${config.param}[content]`]: contentStr,
                };

                const result = await sendCustomizationRequest(
                    page,
                    url,
                    formPayload,
                    formPayload,
                    baseUrl,
                    csrf,
                    refererUrl
                );
                csrf = result.csrf;
                refererUrl = result.refererUrl;

                if (result.ok) {
                    log(`  ✓ ${isUpdate ? 'Updated' : 'Created'} ${c.type} (${result.status})`, 'green');
                    if (isUpdate) updated++;
                    else created++;
                } else {
                    log(`  ✗ ${result.error ? `ERROR: ${result.error.message}` : `FAIL (${result.status})`}`, 'red');
                    failed++;
                }
            }
        }

        if (selectedNavMenu) {
            log('\nStep 7: Posting selected JsonNavigationMenu...', 'blue');
            const contentStr = typeof selectedNavMenu.content === 'string'
                ? selectedNavMenu.content
                : JSON.stringify(selectedNavMenu.content);
            const navIsUpdate = Boolean(targetNavMenuId);
            const navUrl = navIsUpdate
                ? `${baseUrl}/superadmin/json_navigation_menus/${targetNavMenuId}`
                : `${baseUrl}/superadmin/json_navigation_menus`;
            const navPayload = {
                utf8: '✓',
                authenticity_token: csrf,
                ...(navIsUpdate ? { _method: 'patch' } : {}),
                'json_navigation_menu[resource_type]': resolveResourceType(entity.defaultResourceType),
                'json_navigation_menu[resource_id]': String(targetId),
                'json_navigation_menu[content]': contentStr,
                commit: navIsUpdate ? 'Update Json navigation menu' : 'Create Json navigation menu',
            };

            const navResult = await sendCustomizationRequest(
                page,
                navUrl,
                navPayload,
                navPayload,
                baseUrl,
                csrf,
                refererUrl
            );
            csrf = navResult.csrf;
            refererUrl = navResult.refererUrl;

            if (navResult.ok) {
                log(`  ✓ ${navIsUpdate ? 'Updated' : 'Created'} JsonNavigationMenu (${navResult.status})`, 'green');
                if (navIsUpdate) updated++;
                else created++;
            } else {
                log(`  ✗ ${navResult.error ? `ERROR: ${navResult.error.message}` : `FAIL (${navResult.status})`}`, 'red');
                failed++;
            }
        }

        if (selectedGlobals.length > 0) {
            log('\nStep 8: Posting selected Global...', 'blue');
            const globalRow = selectedGlobals[0];
            const contentStr = typeof globalRow.content === 'string' ? globalRow.content : JSON.stringify(globalRow.content);
            const globalIsUpdate = Boolean(targetGlobalId);
            const globalUrl = globalIsUpdate
                ? `${baseUrl}/superadmin/globals/${targetGlobalId}`
                : `${baseUrl}/superadmin/globals`;
            const globalPayload = {
                utf8: '✓',
                authenticity_token: csrf,
                ...(globalIsUpdate ? { _method: 'patch' } : {}),
                'global[resource_type]': resolveResourceType(entity.defaultResourceType),
                'global[resource_id]': String(targetId),
                'global[content]': contentStr,
            };
            const globalFallbackPayload = globalIsUpdate
                ? {
                    utf8: '✓',
                    'global[resource_type]': resolveResourceType(entity.defaultResourceType),
                    'global[resource_id]': String(targetId),
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
                log(`  ✓ ${globalIsUpdate ? 'Updated' : 'Created'} Global (${globalResult.status})`, 'green');
                if (globalIsUpdate) updated++;
                else created++;
            } else {
                log(`  ✗ ${globalResult.error ? `ERROR: ${globalResult.error.message}` : `FAIL (${globalResult.status})`}`, 'red');
                failed++;
            }
        }

        if (selectedCustomTexts.length > 0) {
            log('\nStep 9: Posting selected Custom Texts...', 'blue');
            log('-'.repeat(70), 'cyan');

            for (const ct of selectedCustomTexts) {
                const contentStr = typeof ct.content === 'string' ? ct.content : JSON.stringify(ct.content);
                const langId = String(ct.language_id);
                const existingCustomTextId = targetCustomTextMap.get(langId);
                const customTextIsUpdate = Boolean(existingCustomTextId);
                const customTextUrl = customTextIsUpdate
                    ? `${baseUrl}/superadmin/custom_texts/${existingCustomTextId}`
                    : `${baseUrl}/superadmin/custom_texts`;
                const customTextPayload = {
                    utf8: '✓',
                    authenticity_token: csrf,
                    ...(customTextIsUpdate ? { _method: 'patch' } : {}),
                    'custom_text[resource_type]': resolveResourceType(entity.defaultResourceType),
                    'custom_text[resource_id]': String(targetId),
                    'custom_text[language_id]': langId,
                    'custom_text[content]': contentStr,
                };
                const customTextFallbackPayload = customTextIsUpdate
                    ? {
                        utf8: '✓',
                        'custom_text[resource_type]': resolveResourceType(entity.defaultResourceType),
                        'custom_text[resource_id]': String(targetId),
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
                    log(`  ✓ ${customTextIsUpdate ? 'Updated' : 'Created'} Custom Text (lang=${langId})`, 'green');
                    if (customTextIsUpdate) updated++;
                    else created++;
                } else {
                    log(`  ✗ ${customTextResult.error ? `ERROR: ${customTextResult.error.message}` : `FAIL (${customTextResult.status})`}`, 'red');
                    failed++;
                }
            }
        }

        log('\n' + '='.repeat(70), 'cyan');
        log('  COPY SUMMARY', 'bright');
        log('='.repeat(70), 'cyan');
        log(`Source ${entity.label}: "${srcRows[0].name}" (#${sourceId})`, 'yellow');
        log(`Target ${entity.label}: "${tgtRows[0].name}" (#${targetId})`, 'yellow');
        log(`Selected Items: ${totalToCopy}`, 'yellow');
        log(`✓ Created: ${created}`, 'green');
        log(`↻ Updated: ${updated}`, 'green');
        log(`✗ Failed:  ${failed}`, failed > 0 ? 'red' : 'green');
        log(`Success Rate: ${(((created + updated) / totalToCopy) * 100).toFixed(1)}%`, 'magenta');
        log('='.repeat(70) + '\n', 'cyan');
    } finally {
        if (rl) rl.close();
        await pool.end();
        if (browser) await browser.close();
    }
}

export async function runCopyFromCli(fixedEntityType = null) {
    const args = process.argv.slice(2);
    let entityType = fixedEntityType || null;
    let sourceArg = null;
    let targetArg = null;
    let copySectionsArg = null;

    if (fixedEntityType) {
        [sourceArg, targetArg, copySectionsArg] = args;
    } else if (ENTITY_CONFIG[args[0]]) {
        [entityType, sourceArg, targetArg, copySectionsArg] = args;
    } else if (args.length >= 3 && ENTITY_CONFIG[args[2]]) {
        // Backward-compatible order: <sourceId> <targetId> <org|company> [sections]
        [sourceArg, targetArg, entityType, copySectionsArg] = args;
    }

    if (!entityType || sourceArg == null || targetArg == null) {
        log('\n✗ Error: Missing required arguments', 'red');
        log('\nUsage:', 'yellow');
        log('  node scripts/copyCustomizations.js <org|company> <sourceId> <targetId>', 'cyan');
        log('  node scripts/copyCustomizations.js <org|company> <sourceId> <targetId> <sectionsCsv>', 'cyan');
        log('  node scripts/copyCustomizations.js <sourceId> <targetId> <org|company> [sectionsCsv]', 'cyan');
        log('  sectionsCsv values: global,custom_texts,json_navigation_menu', 'cyan');
        log('  node scripts/copyOrgCustomizations.js <sourceOrgId> <targetOrgId>', 'cyan');
        log('  node scripts/copyCompanyCustomizations.js <sourceCompanyId> <targetCompanyId>', 'cyan');
        process.exit(1);
    }

    if (!ENTITY_CONFIG[entityType]) {
        log('\n✗ Error: First argument must be "org" or "company"', 'red');
        process.exit(1);
    }

    const sourceId = Number(sourceArg);
    const targetId = Number(targetArg);
    if (Number.isNaN(sourceId) || Number.isNaN(targetId)) {
        log('\n✗ Error: Source and target IDs must be numbers', 'red');
        process.exit(1);
    }
    if (sourceId === targetId) {
        log('\n✗ Error: Source and target cannot be the same', 'red');
        process.exit(1);
    }

    try {
        await copyCustomizations(entityType, sourceId, targetId, {
            nonInteractive: !process.stdin.isTTY || !process.stdout.isTTY,
            copySections: copySectionsArg || '',
        });
        log('✓ Script completed successfully\n', 'green');
        process.exit(0);
    } catch (error) {
        log(`\n✗ Script failed: ${error.message}\n`, 'red');
        console.error(error);
        process.exit(1);
    }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/copyCustomizations.js')) {
    runCopyFromCli();
}
