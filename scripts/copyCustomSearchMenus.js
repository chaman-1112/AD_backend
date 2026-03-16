/**
 * Standalone Custom Search Menu Replication Script
 *
 * Copies Custom Search Menu Types (parents + children with images)
 * and Custom Search Menus from one org to another.
 *
 * Usage:
 *   node scripts/copyCustomSearchMenus.js <sourceOrgId> <targetOrgId>
 *
 * Example:
 *   node scripts/copyCustomSearchMenus.js 799 945
 */

import { chromium } from '@playwright/test';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const CLOUDFRONT_BASE = String(process.env.CLOUDFRONT_BASE || '')
    .trim()
    .replace(/\/+$/, '');

const PRODUCT_TYPE_MAP = {
    1: 'diamond',
    2: 'jewelry',
    3: 'gemstone',
    4: 'lab_grown_diamond',
};

const DESIGN_TYPE_MAP = {
    0: '',
    1: 'rectangular_text_button',
    2: 'square_icon_button',
    3: 'bg_square_icon_button',
    4: 'round_text_button',
    5: 'drop_down',
    6: 'slider',
    7: 'rectangular_text_button_with_price',
    8: 'drop_down_select',
    9: 'square_icon_button_with_slider',
    10: 'square_icon_button_with_bg',
    11: 'square_icon_button_with_slider_and_bg',
    12: 'multiselect_checkbox_with_dropdown',
    13: 'checkbox_with_dropdown',
    14: 'checkbox',
    15: 'center_meas',
    16: 'media_button-compact-no_carousel',
    17: 'media_button-labeled-no_carousel',
    18: 'media_button-labeled_2_line-no_carousel',
    19: 'media_button-compact-with_carousel',
    20: 'media_button-labeled-with_carousel',
    21: 'media_button-labeled_2_line-with_carousel',
    22: 'text_button-dynamic-no_carousel',
    23: 'text_button-2_line-no_carousel',
    24: 'text_button-with_price-no_carousel',
    25: 'text_button-dynamic-with_carousel',
    26: 'text_button-2_line-with_carousel',
    27: 'text_button-with_price-with_carousel',
    28: 'checkbox_button-default-no_carousel',
    29: 'checkbox_button-radio-no_carousel',
    30: 'dropdown-default-no_carousel',
    31: 'input_filed-measurement-no_carousel',
    32: 'input_filed-range-no_carousel',
    33: 'input_filed-default-no_carousel',
    34: 'slider-default-no_carousel',
    35: 'slider-range-no_carousel',
};

const PURPOSE_MAP = {
    0: 'custom_search_menu',
    1: 'custom_description',
};

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

function createPool() {
    return new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
}

// ── DB Queries ──

async function fetchParentMenuTypes(pool, sourceId, scope) {
    const whereClause = scope === 'company'
        ? `scope_type = 'Company' AND scope_id = $1`
        : `organization_id = $1`;
    const { rows } = await pool.query(
        `SELECT *
         FROM custom_search_menu_types
         WHERE id IN (
             SELECT custom_search_menu_type_id
             FROM custom_search_menus
             WHERE ${whereClause}
         )`,
        [sourceId]
    );
    return rows;
}

async function fetchChildMenuTypes(pool, parentIds) {
    if (parentIds.length === 0) return [];
    const { rows } = await pool.query(
        `SELECT *
         FROM custom_search_menu_types
         WHERE parent_id = ANY($1::int[])`,
        [parentIds]
    );
    return rows;
}

async function fetchCustomSearchMenus(pool, sourceId, scope) {
    const whereClause = scope === 'company'
        ? `scope_type = 'Company' AND scope_id = $1`
        : `organization_id = $1`;
    const { rows } = await pool.query(
        `SELECT *
         FROM custom_search_menus
         WHERE ${whereClause}`,
        [sourceId]
    );
    return rows;
}

// ── Image Download ──

async function downloadIcon(type, rowId, filename) {
    if (!filename || !filename.trim()) return null;
    if (!CLOUDFRONT_BASE) {
        log(`    ⚠ CLOUDFRONT_BASE is not set; cannot download ${type}`, 'yellow');
        return null;
    }
    const url = `${CLOUDFRONT_BASE}/${type}/${rowId}/${filename}`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            log(`    ⚠ Could not download ${type} (${res.status}): ${url}`, 'yellow');
            return null;
        }
        const arrayBuf = await res.arrayBuffer();
        const mimeType = type === 'png_icon' ? 'image/png' : 'image/svg+xml';
        return { name: filename, mimeType, buffer: Buffer.from(arrayBuf) };
    } catch (err) {
        log(`    ⚠ Download error for ${type}: ${err.message}`, 'yellow');
        return null;
    }
}

// ── Browser Helpers ──

async function loginAndGetPage(baseUrl) {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        httpCredentials: {
            username: process.env.STAGE_DATA_HTTP_USERNAME,
            password: process.env.STAGE_DATA_HTTP_PASSWORD,
        },
    });
    const page = await context.newPage();

    await page.goto(`${baseUrl}/superadmin/login`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
    await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForLoadState('networkidle');

    return { browser, context, page };
}

async function getCsrfToken(page, baseUrl) {
    await page.goto(`${baseUrl}/superadmin/custom_search_menu_types`, { waitUntil: 'networkidle' });
    const csrf = await page.evaluate(() =>
        document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    );
    if (!csrf) {
        const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 200));
        throw new Error(`Could not obtain CSRF token. Page content: ${bodySnippet}`);
    }
    return csrf;
}

async function fixDesignType(page, baseUrl, sourceTypeId, newTypeId) {
    try {
        await page.goto(`${baseUrl}/superadmin/custom_search_menu_types/${sourceTypeId}/edit`, { waitUntil: 'networkidle' });
        const srcSelect = page.locator('#custom_search_menu_type_design_type');
        if (await srcSelect.count() === 0) return false;
        const srcValue = await srcSelect.inputValue();

        await page.goto(`${baseUrl}/superadmin/custom_search_menu_types/${newTypeId}/edit`, { waitUntil: 'networkidle' });
        const dstSelect = page.locator('#custom_search_menu_type_design_type');
        if (await dstSelect.count() === 0) return false;
        const dstValue = await dstSelect.inputValue();

        if (srcValue === dstValue) return true;

        await dstSelect.selectOption(srcValue);
        await page.waitForTimeout(300);
        const submitBtn = page.getByRole('button', { name: /update/i });
        if (await submitBtn.count() > 0) {
            await submitBtn.click();
            await page.waitForLoadState('networkidle');
        }
        return true;
    } catch (err) {
        log(`    ⚠ design_type fix failed: ${err.message}`, 'yellow');
        return false;
    }
}

function checkRedirect(response, resourcePath) {
    const status = response.status();
    const location = response.headers()['location'] || '';
    const regex = new RegExp(`\\/${resourcePath}\\/(\\d+)`);
    const match = location.match(regex);
    if (status === 302 && match) {
        return { ok: true, status, location, newId: parseInt(match[1]) };
    }
    return { ok: false, status, location, newId: null };
}

// ── Translation Helpers ──

function extractTranslationNames(translations) {
    if (!translations) return {};
    const t = typeof translations === 'string' ? JSON.parse(translations) : translations;
    const result = {};
    for (const [lang, obj] of Object.entries(t)) {
        if (obj && obj.name) {
            result[lang] = obj.name;
        }
    }
    return result;
}

// ── POST: Create Menu Type ──

async function createMenuType(page, csrf, baseUrl, menuType, parentId, pngPayload, svgPayload) {
    const names = extractTranslationNames(menuType.translations);
    const additional = typeof menuType.additional_attributes === 'string'
        ? JSON.parse(menuType.additional_attributes || '{}')
        : (menuType.additional_attributes || {});

    const productTypeStr = PRODUCT_TYPE_MAP[menuType.product_type] || 'jewelry';
    const purposeStr = PURPOSE_MAP[menuType.purpose] ?? 'custom_search_menu';
    const designTypeStr = DESIGN_TYPE_MAP[menuType.design_type] ?? '';

    const formData = {
        'utf8': '✓',
        'authenticity_token': csrf,
        'custom_search_menu_type[parent_id]': parentId ? String(parentId) : '',
        'custom_search_menu_type[search_key]': menuType.search_key || '',
        'custom_search_menu_type[product_type]': productTypeStr,
        'custom_search_menu_type[menu_order]': String(menuType.menu_order ?? 0),
        'custom_search_menu_type[status]': menuType.status === true || menuType.status === 'true' || menuType.status === 't' ? '1' : '0',
        'custom_search_menu_type[name_en]': names.en || '',
        'custom_search_menu_type[name_ko]': names.ko || '',
        'custom_search_menu_type[name_it]': names.it || '',
        'custom_search_menu_type[name_es]': names.es || '',
        'custom_search_menu_type[name_ru]': names.ru || '',
        'custom_search_menu_type[name_fr]': names.fr || '',
        'custom_search_menu_type[name_de]': names.de || '',
        'custom_search_menu_type[name_pt]': names.pt || '',
        'custom_search_menu_type[name_zh]': names.zh || '',
        'custom_search_menu_type[name_zt]': names.zt || '',
        'custom_search_menu_type[purpose]': purposeStr,
        'custom_search_menu_type[design_type]': designTypeStr,
        'custom_search_menu_type[helper_text]': additional.helper_text || '',
        'custom_search_menu_type[slug]': additional.slug || '0',
        'custom_search_menu_type[is_resettable]': additional.is_resettable || '0',
        'custom_search_menu_type[reset_button_visible]': additional.reset_button_visible || '0',
        'custom_search_menu_type[reinitialize_index_on_change]': additional.reinitialize_index_on_change || '0',
        'custom_search_menu_type[group]': additional.group || '',
        'custom_search_menu_type[is_addon]': additional.is_addon || '0',
        'custom_search_menu_type[addon_cost]': additional.addon_cost || '0.0',
        'custom_search_menu_type[config_property]': additional.config_property || '',
        'custom_search_menu_type[config_part]': additional.config_part || '',
        'custom_search_menu_type[config_value]': additional.config_value || '',
        'custom_search_menu_type[config_merge_group]': additional.config_merge_group || '',
        'custom_search_menu_type[config_merge_position]': additional.config_merge_position || '',
        'custom_search_menu_type[config_file_extension]': additional.config_file_extension || '',
        'custom_search_menu_type[option_3d_type]': additional.option_3d_type || '',
        'commit': 'Create Custom search menu type',
    };

    if (pngPayload) formData['custom_search_menu_type[png_icon]'] = pngPayload;
    if (svgPayload) formData['custom_search_menu_type[svg_icon]'] = svgPayload;

    return page.request.post(
        `${baseUrl}/superadmin/custom_search_menu_types`,
        { multipart: formData, maxRedirects: 0 }
    );
}

// ── POST: Create Custom Search Menu ──

async function createSearchMenu(page, csrf, baseUrl, targetId, menu, mappedTypeId, scope) {
    const scopeType = scope === 'company' ? 'Company' : 'Organization';
    const idField = scope === 'company' ? 'company_id' : 'organization_id';
    return page.request.post(
        `${baseUrl}/superadmin/custom_search_menus`,
        {
            multipart: {
                'utf8': '✓',
                'authenticity_token': csrf,
                'custom_search_menu[scope_type]': scopeType,
                [`custom_search_menu[${idField}]`]: String(targetId),
                'custom_search_menu[custom_search_menu_type_id]': String(mappedTypeId),
                'custom_search_menu[menu_order]': String(menu.menu_order ?? 0),
                'commit': 'Create Custom search menu',
            },
            maxRedirects: 0,
        }
    );
}

// ── Main ──

async function copyCustomSearchMenus(sourceId, targetId, sourceScope = 'org', targetScope = sourceScope) {
    const sourceIsCompany = sourceScope === 'company';
    const targetIsCompany = targetScope === 'company';
    const sourceLabel = sourceIsCompany ? 'Company' : 'Org';
    const targetLabel = targetIsCompany ? 'Company' : 'Org';

    log('\n' + '='.repeat(70), 'cyan');
    log('  CUSTOM SEARCH MENU REPLICATION SCRIPT', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\nSource Scope: ${sourceLabel}`, 'yellow');
    log(`Target Scope: ${targetLabel}`, 'yellow');
    log(`Source ${sourceLabel} ID: ${sourceId}`, 'yellow');
    log(`Target ${targetLabel} ID: ${targetId}`, 'yellow');
    log(`Base URL: ${process.env.STAGE_BASE_URL}\n`, 'yellow');

    const pool = createPool();
    let browser;

    try {
        // ── Step 1: Verify source/target ──
        log('Step 1: Verifying source and target...', 'blue');

        const sourceTable = sourceIsCompany ? 'companies' : 'organizations';
        const { rows: srcRows } = await pool.query(
            `SELECT id, name FROM ${sourceTable} WHERE id = $1`, [sourceId]
        );
        if (srcRows.length === 0) throw new Error(`Source ${sourceLabel.toLowerCase()} #${sourceId} not found`);
        log(`  ✓ Source: "${srcRows[0].name}" (#${srcRows[0].id})`, 'green');

        const targetTable = targetIsCompany ? 'companies' : 'organizations';
        const { rows: tgtRows } = await pool.query(
            `SELECT id, name FROM ${targetTable} WHERE id = $1`, [targetId]
        );
        if (tgtRows.length === 0) throw new Error(`Target ${targetLabel.toLowerCase()} #${targetId} not found`);
        log(`  ✓ Target: "${tgtRows[0].name}" (#${tgtRows[0].id})`, 'green');

        // ── Step 2: Fetch all data from source ──
        log(`\nStep 2: Fetching data from source ${sourceLabel.toLowerCase()}...`, 'blue');

        const parents = await fetchParentMenuTypes(pool, sourceId, sourceScope);
        const parentIds = parents.map(p => p.id);
        log(`  Parent Menu Types: ${parents.length}`, 'cyan');
        for (const p of parents) {
            const names = extractTranslationNames(p.translations);
            log(`    → id=${p.id} "${names.en || p.search_key}" png=${p.png_icon || '(none)'} svg=${p.svg_icon || '(none)'}`, 'cyan');
        }

        const children = await fetchChildMenuTypes(pool, parentIds);
        log(`  Child Menu Types: ${children.length}`, 'cyan');
        for (const c of children) {
            const names = extractTranslationNames(c.translations);
            log(`    → id=${c.id} parent=${c.parent_id} "${names.en || c.search_key}" png=${c.png_icon || '(none)'} svg=${c.svg_icon || '(none)'}`, 'cyan');
        }

        const menus = await fetchCustomSearchMenus(pool, sourceId, sourceScope);
        log(`  Custom Search Menus: ${menus.length}`, 'cyan');

        const total = parents.length + children.length + menus.length;
        if (total === 0) {
            log('\n  ✗ Nothing to copy.', 'yellow');
            return;
        }
        log(`\n  Total items to copy: ${total}`, 'yellow');

        // ── Step 3: Launch browser and login ──
        log('\nStep 3: Launching browser and logging in...', 'blue');
        const baseUrl = process.env.STAGE_BASE_URL;
        const session = await loginAndGetPage(baseUrl);
        browser = session.browser;
        const { page } = session;
        log('  ✓ Logged in successfully', 'green');

        let csrf = await getCsrfToken(page, baseUrl);
        log(`  ✓ CSRF token obtained`, 'green');

        const typeIdMapping = new Map();
        let createdTypes = 0;
        let createdMenus = 0;
        let failedTypes = 0;
        let failedMenus = 0;

        // ── Step 4: Create parent menu types ──
        log('\nStep 4: Creating parent menu types...', 'blue');
        log('-'.repeat(70), 'cyan');

        for (const parent of parents) {
            const names = extractTranslationNames(parent.translations);
            log(`\n→ id=${parent.id} "${names.en || parent.search_key}"`, 'yellow');

            const [pngPayload, svgPayload] = await Promise.all([
                downloadIcon('png_icon', parent.id, parent.png_icon),
                downloadIcon('svg_icon', parent.id, parent.svg_icon),
            ]);
            if (pngPayload) log(`    PNG: ${pngPayload.buffer.length} bytes`, 'cyan');
            if (svgPayload) log(`    SVG: ${svgPayload.buffer.length} bytes`, 'cyan');

            csrf = await getCsrfToken(page, baseUrl);

            let ok = false;
            let newTypeId = null;
            try {
                const response = await createMenuType(page, csrf, baseUrl, parent, null, pngPayload, svgPayload);
                const result = checkRedirect(response, 'custom_search_menu_types');
                log(`    status=${result.status} location=${result.location}`, 'cyan');
                if (result.ok) {
                    typeIdMapping.set(parent.id, result.newId);
                    newTypeId = result.newId;
                    log(`    ✓ Created (${result.status}) → new id=${result.newId}`, 'green');
                    ok = true;
                    createdTypes++;
                } else {
                    const body = await response.text().catch(() => '');
                    log(`    ✗ FAIL (${result.status})`, 'red');
                    if (body) log(`    Response: ${body.substring(0, 300)}`, 'red');
                }
            } catch (err) {
                log(`    ✗ ERROR: ${err.message}`, 'red');
            }

            if (!ok) {
                log(`    Retrying with fresh CSRF...`, 'yellow');
                try {
                    csrf = await getCsrfToken(page, baseUrl);
                    const response = await createMenuType(page, csrf, baseUrl, parent, null, pngPayload, svgPayload);
                    const result = checkRedirect(response, 'custom_search_menu_types');
                    if (result.ok) {
                        typeIdMapping.set(parent.id, result.newId);
                        newTypeId = result.newId;
                        log(`    ✓ OK on retry → new id=${result.newId}`, 'green');
                        ok = true;
                        createdTypes++;
                    } else {
                        log(`    ✗ Retry failed (${result.status})`, 'red');
                    }
                } catch (err) {
                    log(`    ✗ Retry error: ${err.message}`, 'red');
                }
            }

            if (ok && newTypeId) {
                const fixed = await fixDesignType(page, baseUrl, parent.id, newTypeId);
                if (fixed) log(`    ✓ design_type synced from source`, 'green');
            }

            if (!ok) failedTypes++;
        }

        // ── Step 5: Create child menu types ──
        if (children.length > 0) {
            log('\n\nStep 5: Creating child menu types...', 'blue');
            log('-'.repeat(70), 'cyan');

            for (const child of children) {
                const names = extractTranslationNames(child.translations);
                const mappedParentId = typeIdMapping.get(child.parent_id);

                if (!mappedParentId) {
                    log(`\n→ id=${child.id} "${names.en || child.search_key}" — SKIPPED (parent ${child.parent_id} not mapped)`, 'red');
                    failedTypes++;
                    continue;
                }

                log(`\n→ id=${child.id} "${names.en || child.search_key}" parent=${child.parent_id}→${mappedParentId}`, 'yellow');

                const [pngPayload, svgPayload] = await Promise.all([
                    downloadIcon('png_icon', child.id, child.png_icon),
                    downloadIcon('svg_icon', child.id, child.svg_icon),
                ]);
                if (pngPayload) log(`    PNG: ${pngPayload.buffer.length} bytes`, 'cyan');
                if (svgPayload) log(`    SVG: ${svgPayload.buffer.length} bytes`, 'cyan');

                csrf = await getCsrfToken(page, baseUrl);

                let ok = false;
                let newTypeId = null;
                try {
                    const response = await createMenuType(page, csrf, baseUrl, child, mappedParentId, pngPayload, svgPayload);
                    const result = checkRedirect(response, 'custom_search_menu_types');
                    log(`    status=${result.status} location=${result.location}`, 'cyan');
                    if (result.ok) {
                        typeIdMapping.set(child.id, result.newId);
                        newTypeId = result.newId;
                        log(`    ✓ Created (${result.status}) → new id=${result.newId}`, 'green');
                        ok = true;
                        createdTypes++;
                    } else {
                        const body = await response.text().catch(() => '');
                        log(`    ✗ FAIL (${result.status})`, 'red');
                        if (body) log(`    Response: ${body.substring(0, 300)}`, 'red');
                    }
                } catch (err) {
                    log(`    ✗ ERROR: ${err.message}`, 'red');
                }

                if (!ok) {
                    log(`    Retrying with fresh CSRF...`, 'yellow');
                    try {
                        csrf = await getCsrfToken(page, baseUrl);
                        const response = await createMenuType(page, csrf, baseUrl, child, mappedParentId, pngPayload, svgPayload);
                        const result = checkRedirect(response, 'custom_search_menu_types');
                        if (result.ok) {
                            typeIdMapping.set(child.id, result.newId);
                            newTypeId = result.newId;
                            log(`    ✓ OK on retry → new id=${result.newId}`, 'green');
                            ok = true;
                            createdTypes++;
                        } else {
                            log(`    ✗ Retry failed (${result.status})`, 'red');
                        }
                    } catch (err) {
                        log(`    ✗ Retry error: ${err.message}`, 'red');
                    }
                }

                if (ok && newTypeId) {
                    const fixed = await fixDesignType(page, baseUrl, child.id, newTypeId);
                    if (fixed) log(`    ✓ design_type synced from source`, 'green');
                }

                if (!ok) failedTypes++;
            }
        } else {
            log('\nStep 5: No child menu types — skipping', 'yellow');
        }

        // ── Step 6: Create custom search menus ──
        if (menus.length > 0) {
            log('\n\nStep 6: Creating custom search menus...', 'blue');
            log('-'.repeat(70), 'cyan');

            for (const menu of menus) {
                const mappedTypeId = typeIdMapping.get(menu.custom_search_menu_type_id);

                if (!mappedTypeId) {
                    log(`\n→ menu id=${menu.id} type=${menu.custom_search_menu_type_id} — SKIPPED (type not mapped)`, 'red');
                    failedMenus++;
                    continue;
                }

                log(`\n→ menu id=${menu.id} type=${menu.custom_search_menu_type_id}→${mappedTypeId} order=${menu.menu_order}`, 'yellow');

                csrf = await getCsrfToken(page, baseUrl);

                let ok = false;
                try {
                    const response = await createSearchMenu(page, csrf, baseUrl, targetId, menu, mappedTypeId, targetScope);
                    const result = checkRedirect(response, 'custom_search_menus');
                    log(`    status=${result.status} location=${result.location}`, 'cyan');
                    if (result.ok) {
                        log(`    ✓ Created (${result.status}) → new id=${result.newId}`, 'green');
                        ok = true;
                        createdMenus++;
                    } else {
                        const body = await response.text().catch(() => '');
                        log(`    ✗ FAIL (${result.status})`, 'red');
                        if (body) log(`    Response: ${body.substring(0, 300)}`, 'red');
                    }
                } catch (err) {
                    log(`    ✗ ERROR: ${err.message}`, 'red');
                }

                if (!ok) {
                    log(`    Retrying with fresh CSRF...`, 'yellow');
                    try {
                        csrf = await getCsrfToken(page, baseUrl);
                        const response = await createSearchMenu(page, csrf, baseUrl, targetId, menu, mappedTypeId, targetScope);
                        const result = checkRedirect(response, 'custom_search_menus');
                        if (result.ok) {
                            log(`    ✓ OK on retry → new id=${result.newId}`, 'green');
                            ok = true;
                            createdMenus++;
                        } else {
                            log(`    ✗ Retry failed (${result.status})`, 'red');
                        }
                    } catch (err) {
                        log(`    ✗ Retry error: ${err.message}`, 'red');
                    }
                }

                if (!ok) failedMenus++;
            }
        } else {
            log('\nStep 6: No custom search menus — skipping', 'yellow');
        }

        // ── Summary ──
        log('\n' + '='.repeat(70), 'cyan');
        log('  REPLICATION SUMMARY', 'bright');
        log('='.repeat(70), 'cyan');
        log(`Source ${sourceLabel}: "${srcRows[0].name}" (#${sourceId})`, 'yellow');
        log(`Target ${targetLabel}: "${tgtRows[0].name}" (#${targetId})`, 'yellow');
        log('', 'reset');
        log(`  Menu Types (parents + children):`, 'yellow');
        log(`    ✓ Created: ${createdTypes}`, 'green');
        log(`    ✗ Failed:  ${failedTypes}`, failedTypes > 0 ? 'red' : 'green');
        log(`  Custom Search Menus:`, 'yellow');
        log(`    ✓ Created: ${createdMenus}`, 'green');
        log(`    ✗ Failed:  ${failedMenus}`, failedMenus > 0 ? 'red' : 'green');
        log('', 'reset');
        const totalCreated = createdTypes + createdMenus;
        const totalFailed = failedTypes + failedMenus;
        log(`  Total: ${totalCreated} created, ${totalFailed} failed`, totalFailed > 0 ? 'red' : 'green');
        log(`  ID Mappings: ${typeIdMapping.size} type(s) mapped`, 'magenta');
        log('='.repeat(70) + '\n', 'cyan');

    } catch (error) {
        log(`\n✗ Fatal Error: ${error.message}`, 'red');
        console.error(error);
    } finally {
        await pool.end();
        if (browser) await browser.close();
    }
}

// ── CLI entry point ──
const args = process.argv.slice(2);

if (args.length < 2) {
    log('\n✗ Error: Missing required arguments', 'red');
    log('\nUsage:', 'yellow');
    log('  node scripts/copyCustomSearchMenus.js <sourceId> <targetId> [scope]', 'cyan');
    log('  node scripts/copyCustomSearchMenus.js <sourceId> <targetId> <sourceScope> <targetScope>', 'cyan');
    log('\n  scope/sourceScope/targetScope: "org" or "company"', 'cyan');
    log('\nExamples:', 'yellow');
    log('  node scripts/copyCustomSearchMenus.js 799 945                     (org -> org)', 'cyan');
    log('  node scripts/copyCustomSearchMenus.js 39416 91268 company         (company -> company)', 'cyan');
    log('  node scripts/copyCustomSearchMenus.js 799 91268 org company       (org -> company)', 'cyan');
    log('  node scripts/copyCustomSearchMenus.js 39416 945 company org       (company -> org)', 'cyan');
    log('\nWhat it copies:', 'yellow');
    log('  • Custom Search Menu Types (parents with images)', 'cyan');
    log('  • Custom Search Menu Types (children with images + mapped parent_id)', 'cyan');
    log('  • Custom Search Menus (with mapped type IDs)', 'cyan');
    process.exit(1);
}

const [srcArg, tgtArg, scopeArg, targetScopeArg] = args;
const sourceId = Number(srcArg);
const targetId = Number(tgtArg);
let sourceScope = 'org';
let targetScope = 'org';

if (scopeArg && targetScopeArg) {
    sourceScope = String(scopeArg).toLowerCase();
    targetScope = String(targetScopeArg).toLowerCase();
} else if (scopeArg) {
    sourceScope = String(scopeArg).toLowerCase();
    targetScope = sourceScope;
}

if (isNaN(sourceId) || isNaN(targetId)) {
    log('\n✗ Error: IDs must be numbers', 'red');
    process.exit(1);
}

if (sourceId === targetId) {
    log('\n✗ Error: Source and target cannot be the same', 'red');
    process.exit(1);
}

if ((sourceScope !== 'org' && sourceScope !== 'company') || (targetScope !== 'org' && targetScope !== 'company')) {
    log('\n✗ Error: Scopes must be "org" or "company"', 'red');
    process.exit(1);
}

copyCustomSearchMenus(sourceId, targetId, sourceScope, targetScope)
    .then(() => {
        log('✓ Script completed successfully\n', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n✗ Script failed: ${error.message}\n`, 'red');
        process.exit(1);
    });
