/**
 * Import custom search menu types and menus from an Excel sheet.
 *
 * Features:
 * - Validates and normalizes frontend-style sheet values.
 * - Accepts human-readable values and maps them to API format
 *   (example: "rectangular text button" -> "rectangular_text_button").
 * - Supports image download from direct URLs and Google Drive file links.
 * - Creates parent types, then child types, then custom search menus.
 *
 * Usage:
 *   node scripts/importCustomSearchMenusFromSheet.js <targetOrgId> <xlsxPath> [sheetName]
 *
 * Examples:
 *   node scripts/importCustomSearchMenusFromSheet.js 945 "C:/Users/me/Downloads/spreadsheet.xlsx"
 *   node scripts/importCustomSearchMenusFromSheet.js 945 "C:/Users/me/Downloads/spreadsheet.xlsx" "Sheet4"
 */

import { chromium } from '@playwright/test';
import pg from 'pg';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

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

function normalizeToken(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[*]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function cleanString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function isEmpty(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

function normalizeBoolean(value, fieldName, rowCtx, { required = false } = {}) {
    if (isEmpty(value)) {
        if (required) throw new Error(`${rowCtx}: "${fieldName}" is required`);
        return null;
    }

    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = normalizeToken(value);
    if (['true', 't', 'yes', 'y', '1'].includes(normalized)) return true;
    if (['false', 'f', 'no', 'n', '0'].includes(normalized)) return false;

    throw new Error(`${rowCtx}: "${fieldName}" must be boolean-like (true/false/yes/no/1/0), received "${value}"`);
}

function normalizeInteger(value, fieldName, rowCtx, { required = false } = {}) {
    if (isEmpty(value)) {
        if (required) throw new Error(`${rowCtx}: "${fieldName}" is required`);
        return null;
    }

    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
        throw new Error(`${rowCtx}: "${fieldName}" must be an integer, received "${value}"`);
    }
    return num;
}

function normalizeNumber(value, fieldName, rowCtx, { required = false } = {}) {
    if (isEmpty(value)) {
        if (required) throw new Error(`${rowCtx}: "${fieldName}" is required`);
        return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
        throw new Error(`${rowCtx}: "${fieldName}" must be numeric, received "${value}"`);
    }
    return num;
}

const PRODUCT_TYPE_ALIASES = {
    diamond: 'diamond',
    jewelry: 'jewelry',
    gemstone: 'gemstone',
    lab_grown_diamond: 'lab_grown_diamond',
    labgrown_diamond: 'lab_grown_diamond',
    lab_grown: 'lab_grown_diamond',
};

const PURPOSE_ALIASES = {
    custom_search_menu: 'custom_search_menu',
    custom_description: 'custom_description',
};

const DESIGN_TYPE_VALUES = [
    '',
    'rectangular_text_button',
    'square_icon_button',
    'bg_square_icon_button',
    'round_text_button',
    'drop_down',
    'slider',
    'rectangular_text_button_with_price',
    'drop_down_select',
    'square_icon_button_with_slider',
    'square_icon_button_with_bg',
    'square_icon_button_with_slider_and_bg',
    'multiselect_checkbox_with_dropdown',
    'checkbox_with_dropdown',
    'checkbox',
    'center_meas',
    'media_button-compact-no_carousel',
    'media_button-labeled-no_carousel',
    'media_button-labeled_2_line-no_carousel',
    'media_button-compact-with_carousel',
    'media_button-labeled-with_carousel',
    'media_button-labeled_2_line-with_carousel',
    'text_button-dynamic-no_carousel',
    'text_button-2_line-no_carousel',
    'text_button-with_price-no_carousel',
    'text_button-dynamic-with_carousel',
    'text_button-2_line-with_carousel',
    'text_button-with_price-with_carousel',
    'checkbox_button-default-no_carousel',
    'checkbox_button-radio-no_carousel',
    'dropdown-default-no_carousel',
    'input_filed-measurement-no_carousel',
    'input_filed-range-no_carousel',
    'input_filed-default-no_carousel',
    'slider-default-no_carousel',
    'slider-range-no_carousel',
];

const DESIGN_TYPE_ALIASES = (() => {
    const map = new Map();
    for (const value of DESIGN_TYPE_VALUES) {
        if (!value) continue;
        const normalized = normalizeToken(value.replace(/-/g, '_'));
        map.set(normalized, value);
    }

    // Common frontend label variants.
    map.set('round_text_button', 'round_text_button');
    map.set('rectangular_text_button', 'rectangular_text_button');
    map.set('rectangular_text_button_with_price', 'rectangular_text_button_with_price');
    map.set('drop_down', 'drop_down');
    map.set('dropdown', 'drop_down');
    map.set('dropdown_select', 'drop_down_select');

    return map;
})();

function normalizeProductType(value, rowCtx) {
    const key = normalizeToken(value);
    const resolved = PRODUCT_TYPE_ALIASES[key];
    if (!resolved) {
        throw new Error(`${rowCtx}: invalid "Product type" "${value}". Allowed: diamond, jewelry, gemstone, lab_grown_diamond`);
    }
    return resolved;
}

function normalizePurpose(value, rowCtx) {
    const key = normalizeToken(value);
    const resolved = PURPOSE_ALIASES[key];
    if (!resolved) {
        throw new Error(`${rowCtx}: invalid "Purpose" "${value}". Allowed: custom_search_menu, custom_description`);
    }
    return resolved;
}

function normalizeDesignType(value, rowCtx) {
    if (isEmpty(value)) return '';
    const key = normalizeToken(value);
    const resolved = DESIGN_TYPE_ALIASES.get(key);
    if (!resolved) {
        throw new Error(`${rowCtx}: invalid "Design type" "${value}"`);
    }
    return resolved;
}

function detectMimeTypeFromName(fileName, fallback = 'application/octet-stream') {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return fallback;
}

function parseGoogleDriveFileId(urlString) {
    try {
        const url = new URL(urlString);
        const host = url.hostname.toLowerCase();
        if (!host.includes('drive.google.com') && !host.includes('docs.google.com')) return null;

        const pathParts = url.pathname.split('/').filter(Boolean);

        const fileIndex = pathParts.indexOf('d');
        if (fileIndex > 0 && pathParts[fileIndex - 1] === 'file' && pathParts[fileIndex + 1]) {
            return pathParts[fileIndex + 1];
        }

        const qId = url.searchParams.get('id');
        if (qId) return qId;

        return null;
    } catch {
        return null;
    }
}

function isUrl(value) {
    if (isEmpty(value)) return false;
    return /^https?:\/\//i.test(String(value).trim());
}

async function downloadAsset(sourceValue, preferredNamePrefix, expectedTypeLabel) {
    const source = cleanString(sourceValue);
    if (!source) return null;

    if (!isUrl(source)) {
        const localPath = path.resolve(source);
        if (fs.existsSync(localPath)) {
            const buffer = fs.readFileSync(localPath);
            const fileName = path.basename(localPath);
            return {
                name: fileName,
                mimeType: detectMimeTypeFromName(fileName),
                buffer,
            };
        }

        log(`    ⚠ ${expectedTypeLabel}: unsupported source "${source}" (not URL/local file path)`, 'yellow');
        return null;
    }

    let downloadUrl = source;
    const driveId = parseGoogleDriveFileId(source);
    if (driveId) {
        downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
    } else if (source.includes('drive.google.com')) {
        // Non-file links like folders/search are not downloadable without listing APIs/auth.
        log(`    ⚠ ${expectedTypeLabel}: Google Drive link is not a file link, skipping`, 'yellow');
        return null;
    }

    const response = await fetch(downloadUrl);
    if (!response.ok) {
        log(`    ⚠ ${expectedTypeLabel}: download failed (${response.status})`, 'yellow');
        return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const sourceUrl = new URL(downloadUrl);
    const pathnameName = path.basename(sourceUrl.pathname) || `${preferredNamePrefix}.bin`;
    const contentType = response.headers.get('content-type') || '';

    const fileName = pathnameName.includes('.') ? pathnameName : `${preferredNamePrefix}.bin`;
    const mimeType = contentType.split(';')[0] || detectMimeTypeFromName(fileName);

    return { name: fileName, mimeType, buffer };
}

function resolveHeaderIndexes(headerRow) {
    const normalized = headerRow.map((h) => normalizeToken(h));

    function idx(...candidates) {
        for (const candidate of candidates) {
            const i = normalized.indexOf(normalizeToken(candidate));
            if (i >= 0) return i;
        }
        return -1;
    }

    const indexes = {
        rowId: idx('row id', 'sr_no'),
        parentRowId: idx('parent row id', 'parent_no'),
        parent: idx('parent', 'is_parent'),
        menuOrder: idx('menu order', 'menu_order'),
        svgIcon: idx('svg icon', 'svg_icon'),
        pngIcon: idx('png icon', 'png_icon'),
        searchKey: idx('search key', 'search_key'),
        productType: idx('product type', 'product_type'),
        status: idx('status'),
        nameEn: idx('name english', 'name en'),
        nameKo: idx('name korean', 'name ko'),
        nameIt: idx('name italian', 'name it'),
        nameEs: idx('name spanish', 'name es'),
        nameRu: idx('name russian', 'name ru'),
        nameFr: idx('name french', 'name fr'),
        nameDe: idx('name german', 'name de'),
        namePt: idx('name portuguese', 'name pt'),
        nameZh: idx('name simplified chinese', 'name zh'),
        nameZt: idx('name traditional chinese', 'name zt'),
        purpose: idx('purpose', 'purpose_map'),
        designType: idx('design type', 'design_type'),
        helperText: idx('helper text'),
        slug: idx('slug'),
        isResettable: idx('is resettable'),
        resetButtonVisible: idx('reset button visible'),
        reinitializeIndexOnChange: idx('reinitialize index on change'),
        group: idx('group'),
        isAddon: idx('is addon'),
        addonCost: idx('addon cost'),
        configProperty: idx('config property'),
        configPart: idx('config part'),
        configValue: idx('config value'),
        configMergeGroup: idx('config merge group'),
        configMergePosition: idx('config merge position'),
        configFileExtension: idx('config file extension'),
        option3dType: idx('option 3d type'),
    };

    const requiredHeaders = ['parent', 'searchKey', 'productType', 'status', 'purpose'];
    const missing = requiredHeaders.filter((key) => indexes[key] < 0);
    if (missing.length > 0) {
        throw new Error(`Missing required headers: ${missing.join(', ')}`);
    }

    return indexes;
}

function rowIsCompletelyEmpty(row) {
    return row.every((cell) => isEmpty(cell));
}

function getCell(row, index) {
    if (index < 0) return '';
    return row[index];
}

function toFormBoolean(value, fallback = '0') {
    if (value === null || value === undefined || value === '') return fallback;
    return value ? '1' : '0';
}

function parseSpreadsheetRows(workbookPath, sheetNameArg) {
    const workbook = XLSX.readFile(workbookPath, { raw: true });
    const sheetName = sheetNameArg || workbook.SheetNames[0];
    if (!sheetName || !workbook.Sheets[sheetName]) {
        throw new Error(`Sheet "${sheetNameArg}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) {
        throw new Error(`Sheet "${sheetName}" has no data rows`);
    }

    const headerRow = rows[0];
    const headerIndexes = resolveHeaderIndexes(headerRow);

    const parsedRows = [];
    const validationErrors = [];
    const seenRowIds = new Set();

    for (let i = 1; i < rows.length; i++) {
        const rawRow = rows[i];
        if (rowIsCompletelyEmpty(rawRow)) continue;

        const excelRowNumber = i + 1;
        const rowCtx = `Sheet row ${excelRowNumber}`;

        try {
            const rowId = normalizeInteger(getCell(rawRow, headerIndexes.rowId), 'Row ID', rowCtx, { required: true });
            if (seenRowIds.has(rowId)) {
                throw new Error(`${rowCtx}: duplicate "Row ID" ${rowId}`);
            }
            seenRowIds.add(rowId);

            const isParent = normalizeBoolean(getCell(rawRow, headerIndexes.parent), 'Parent', rowCtx, { required: true });
            const parentRowId = normalizeInteger(getCell(rawRow, headerIndexes.parentRowId), 'Parent Row ID', rowCtx);
            const menuOrder = normalizeInteger(getCell(rawRow, headerIndexes.menuOrder), 'Menu order', rowCtx);

            const searchKey = cleanString(getCell(rawRow, headerIndexes.searchKey));
            if (!searchKey) throw new Error(`${rowCtx}: "Search key" is required`);

            const productType = normalizeProductType(getCell(rawRow, headerIndexes.productType), rowCtx);
            const purpose = normalizePurpose(getCell(rawRow, headerIndexes.purpose), rowCtx);
            const designType = normalizeDesignType(getCell(rawRow, headerIndexes.designType), rowCtx);
            const status = normalizeBoolean(getCell(rawRow, headerIndexes.status), 'Status', rowCtx, { required: true });

            if (isParent && menuOrder === null) {
                throw new Error(`${rowCtx}: parent row requires "Menu order"`);
            }
            if (!isParent && parentRowId === null) {
                throw new Error(`${rowCtx}: child row requires "Parent Row ID"`);
            }

            const translations = {};
            const nameMap = {
                en: cleanString(getCell(rawRow, headerIndexes.nameEn)),
                ko: cleanString(getCell(rawRow, headerIndexes.nameKo)),
                it: cleanString(getCell(rawRow, headerIndexes.nameIt)),
                es: cleanString(getCell(rawRow, headerIndexes.nameEs)),
                ru: cleanString(getCell(rawRow, headerIndexes.nameRu)),
                fr: cleanString(getCell(rawRow, headerIndexes.nameFr)),
                de: cleanString(getCell(rawRow, headerIndexes.nameDe)),
                pt: cleanString(getCell(rawRow, headerIndexes.namePt)),
                zh: cleanString(getCell(rawRow, headerIndexes.nameZh)),
                zt: cleanString(getCell(rawRow, headerIndexes.nameZt)),
            };

            for (const [lang, value] of Object.entries(nameMap)) {
                if (value) translations[lang] = { name: value };
            }

            const additionalAttributes = {
                helper_text: cleanString(getCell(rawRow, headerIndexes.helperText)),
                slug: cleanString(getCell(rawRow, headerIndexes.slug)) || '0',
                is_resettable: toFormBoolean(normalizeBoolean(getCell(rawRow, headerIndexes.isResettable), 'Is resettable', rowCtx), '0'),
                reset_button_visible: toFormBoolean(normalizeBoolean(getCell(rawRow, headerIndexes.resetButtonVisible), 'Reset button visible', rowCtx), '0'),
                reinitialize_index_on_change: toFormBoolean(normalizeBoolean(getCell(rawRow, headerIndexes.reinitializeIndexOnChange), 'Reinitialize index on change', rowCtx), '0'),
                group: cleanString(getCell(rawRow, headerIndexes.group)),
                is_addon: toFormBoolean(normalizeBoolean(getCell(rawRow, headerIndexes.isAddon), 'Is addon', rowCtx), '0'),
                addon_cost: (() => {
                    const parsed = normalizeNumber(getCell(rawRow, headerIndexes.addonCost), 'Addon cost', rowCtx);
                    return parsed === null ? '0.0' : String(parsed);
                })(),
                config_property: cleanString(getCell(rawRow, headerIndexes.configProperty)),
                config_part: cleanString(getCell(rawRow, headerIndexes.configPart)),
                config_value: cleanString(getCell(rawRow, headerIndexes.configValue)),
                config_merge_group: cleanString(getCell(rawRow, headerIndexes.configMergeGroup)),
                config_merge_position: cleanString(getCell(rawRow, headerIndexes.configMergePosition)),
                config_file_extension: cleanString(getCell(rawRow, headerIndexes.configFileExtension)),
                option_3d_type: cleanString(getCell(rawRow, headerIndexes.option3dType)),
            };

            parsedRows.push({
                rowId,
                parentRowId,
                isParent,
                menuOrder,
                searchKey,
                productType,
                purpose,
                designType,
                status,
                translations,
                additionalAttributes,
                pngSource: cleanString(getCell(rawRow, headerIndexes.pngIcon)),
                svgSource: cleanString(getCell(rawRow, headerIndexes.svgIcon)),
                excelRowNumber,
            });
        } catch (err) {
            validationErrors.push(err.message);
        }
    }

    if (validationErrors.length > 0) {
        const list = validationErrors.map((e) => `  - ${e}`).join('\n');
        throw new Error(`Validation failed:\n${list}`);
    }

    const rowIdSet = new Set(parsedRows.map((r) => r.rowId));
    const parentIdSet = new Set(parsedRows.filter((r) => r.isParent).map((r) => r.rowId));
    for (const row of parsedRows) {
        if (!row.isParent) {
            if (!rowIdSet.has(row.parentRowId)) {
                throw new Error(`Sheet row ${row.excelRowNumber}: Parent Row ID ${row.parentRowId} does not exist`);
            }
            if (!parentIdSet.has(row.parentRowId)) {
                throw new Error(`Sheet row ${row.excelRowNumber}: Parent Row ID ${row.parentRowId} points to a non-parent row`);
            }
        }
    }

    const parentRows = parsedRows
        .filter((r) => r.isParent)
        .sort((a, b) => (a.menuOrder ?? 0) - (b.menuOrder ?? 0) || a.excelRowNumber - b.excelRowNumber);
    const childRows = parsedRows
        .filter((r) => !r.isParent)
        .sort((a, b) => a.excelRowNumber - b.excelRowNumber);

    return { sheetName, parentRows, childRows };
}

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
    if (!csrf) throw new Error('Could not obtain CSRF token');
    return csrf;
}

function checkRedirect(response, resourcePath) {
    const status = response.status();
    const location = response.headers()['location'] || '';
    const regex = new RegExp(`\\/${resourcePath}\\/(\\d+)`);
    const match = location.match(regex);
    if (status === 302 && match) {
        return { ok: true, status, location, newId: parseInt(match[1], 10) };
    }
    return { ok: false, status, location, newId: null };
}

async function createMenuType(page, csrf, baseUrl, row, mappedParentTypeId, pngPayload, svgPayload) {
    const t = row.translations || {};
    const additional = row.additionalAttributes || {};

    const formData = {
        utf8: '✓',
        authenticity_token: csrf,
        'custom_search_menu_type[parent_id]': mappedParentTypeId ? String(mappedParentTypeId) : '',
        'custom_search_menu_type[search_key]': row.searchKey,
        'custom_search_menu_type[product_type]': row.productType,
        'custom_search_menu_type[menu_order]': String(row.menuOrder ?? 0),
        'custom_search_menu_type[status]': row.status ? '1' : '0',
        'custom_search_menu_type[name_en]': t.en?.name || '',
        'custom_search_menu_type[name_ko]': t.ko?.name || '',
        'custom_search_menu_type[name_it]': t.it?.name || '',
        'custom_search_menu_type[name_es]': t.es?.name || '',
        'custom_search_menu_type[name_ru]': t.ru?.name || '',
        'custom_search_menu_type[name_fr]': t.fr?.name || '',
        'custom_search_menu_type[name_de]': t.de?.name || '',
        'custom_search_menu_type[name_pt]': t.pt?.name || '',
        'custom_search_menu_type[name_zh]': t.zh?.name || '',
        'custom_search_menu_type[name_zt]': t.zt?.name || '',
        'custom_search_menu_type[purpose]': row.purpose,
        'custom_search_menu_type[design_type]': row.designType || '',
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
        commit: 'Create Custom search menu type',
    };

    if (pngPayload) formData['custom_search_menu_type[png_icon]'] = pngPayload;
    if (svgPayload) formData['custom_search_menu_type[svg_icon]'] = svgPayload;

    return page.request.post(`${baseUrl}/superadmin/custom_search_menu_types`, {
        multipart: formData,
        maxRedirects: 0,
    });
}

async function createSearchMenu(page, csrf, baseUrl, targetOrgId, mappedTypeId, menuOrder) {
    return page.request.post(`${baseUrl}/superadmin/custom_search_menus`, {
        multipart: {
            utf8: '✓',
            authenticity_token: csrf,
            'custom_search_menu[scope_type]': 'Organization',
            'custom_search_menu[organization_id]': String(targetOrgId),
            'custom_search_menu[custom_search_menu_type_id]': String(mappedTypeId),
            'custom_search_menu[menu_order]': String(menuOrder ?? 0),
            commit: 'Create Custom search menu',
        },
        maxRedirects: 0,
    });
}

async function importFromSheet(targetOrgId, xlsxPath, sheetName) {
    log('\n' + '='.repeat(74), 'cyan');
    log('  CUSTOM SEARCH MENU IMPORT FROM SHEET', 'bright');
    log('='.repeat(74), 'cyan');
    log(`\nTarget Org ID: ${targetOrgId}`, 'yellow');
    log(`Workbook: ${xlsxPath}`, 'yellow');
    if (sheetName) log(`Sheet: ${sheetName}`, 'yellow');
    log(`Base URL: ${process.env.STAGE_BASE_URL}\n`, 'yellow');

    const pool = createPool();
    let browser;

    try {
        const { rows: targetOrgRows } = await pool.query(
            'SELECT id, name FROM organizations WHERE id = $1',
            [targetOrgId]
        );
        if (targetOrgRows.length === 0) {
            throw new Error(`Target org #${targetOrgId} not found`);
        }
        log(`✓ Target org: "${targetOrgRows[0].name}" (#${targetOrgId})`, 'green');

        log('\nStep 1: Parsing and validating sheet...', 'blue');
        const parsed = parseSpreadsheetRows(xlsxPath, sheetName);
        const parentRows = parsed.parentRows;
        const childRows = parsed.childRows;
        log(`  ✓ Sheet: ${parsed.sheetName}`, 'green');
        log(`  ✓ Parent rows: ${parentRows.length}`, 'cyan');
        log(`  ✓ Child rows: ${childRows.length}`, 'cyan');

        if (parentRows.length === 0 && childRows.length === 0) {
            throw new Error('No rows found to import');
        }

        log('\nStep 2: Login and prepare session...', 'blue');
        const baseUrl = process.env.STAGE_BASE_URL;
        const session = await loginAndGetPage(baseUrl);
        browser = session.browser;
        const { page } = session;
        log('  ✓ Logged in successfully', 'green');

        const rowIdToTypeId = new Map();
        let createdTypes = 0;
        let failedTypes = 0;
        let createdMenus = 0;
        let failedMenus = 0;

        log('\nStep 3: Creating parent menu types...', 'blue');
        for (const row of parentRows) {
            log(`\n→ Parent Row ID ${row.rowId} "${row.searchKey}"`, 'yellow');

            const pngPayload = await downloadAsset(row.pngSource, `row_${row.rowId}_png`, 'PNG');
            const svgPayload = await downloadAsset(row.svgSource, `row_${row.rowId}_svg`, 'SVG');
            if (pngPayload) log(`    PNG loaded: ${pngPayload.name} (${pngPayload.buffer.length} bytes)`, 'cyan');
            if (svgPayload) log(`    SVG loaded: ${svgPayload.name} (${svgPayload.buffer.length} bytes)`, 'cyan');

            let ok = false;
            for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
                try {
                    const csrf = await getCsrfToken(page, baseUrl);
                    const response = await createMenuType(page, csrf, baseUrl, row, null, pngPayload, svgPayload);
                    const result = checkRedirect(response, 'custom_search_menu_types');
                    if (result.ok) {
                        rowIdToTypeId.set(row.rowId, result.newId);
                        createdTypes++;
                        ok = true;
                        log(`    ✓ Created type id=${result.newId}`, 'green');
                    } else {
                        log(`    ✗ Attempt ${attempt} failed (${result.status})`, 'red');
                    }
                } catch (err) {
                    log(`    ✗ Attempt ${attempt} error: ${err.message}`, 'red');
                }
            }
            if (!ok) failedTypes++;
        }

        log('\nStep 4: Creating child menu types...', 'blue');
        for (const row of childRows) {
            const mappedParentTypeId = rowIdToTypeId.get(row.parentRowId);
            log(`\n→ Child Row ID ${row.rowId} "${row.searchKey}" (parent row ${row.parentRowId})`, 'yellow');

            if (!mappedParentTypeId) {
                log('    ✗ Skipped: parent was not created successfully', 'red');
                failedTypes++;
                continue;
            }

            const pngPayload = await downloadAsset(row.pngSource, `row_${row.rowId}_png`, 'PNG');
            const svgPayload = await downloadAsset(row.svgSource, `row_${row.rowId}_svg`, 'SVG');
            if (pngPayload) log(`    PNG loaded: ${pngPayload.name} (${pngPayload.buffer.length} bytes)`, 'cyan');
            if (svgPayload) log(`    SVG loaded: ${svgPayload.name} (${svgPayload.buffer.length} bytes)`, 'cyan');

            let ok = false;
            for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
                try {
                    const csrf = await getCsrfToken(page, baseUrl);
                    const response = await createMenuType(page, csrf, baseUrl, row, mappedParentTypeId, pngPayload, svgPayload);
                    const result = checkRedirect(response, 'custom_search_menu_types');
                    if (result.ok) {
                        rowIdToTypeId.set(row.rowId, result.newId);
                        createdTypes++;
                        ok = true;
                        log(`    ✓ Created type id=${result.newId}`, 'green');
                    } else {
                        log(`    ✗ Attempt ${attempt} failed (${result.status})`, 'red');
                    }
                } catch (err) {
                    log(`    ✗ Attempt ${attempt} error: ${err.message}`, 'red');
                }
            }
            if (!ok) failedTypes++;
        }

        log('\nStep 5: Creating custom search menus for parent rows...', 'blue');
        for (const row of parentRows) {
            const mappedTypeId = rowIdToTypeId.get(row.rowId);
            if (!mappedTypeId) {
                failedMenus++;
                log(`  ✗ Skipped menu for row ${row.rowId}: parent type not created`, 'red');
                continue;
            }

            let ok = false;
            for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
                try {
                    const csrf = await getCsrfToken(page, baseUrl);
                    const response = await createSearchMenu(page, csrf, baseUrl, targetOrgId, mappedTypeId, row.menuOrder);
                    const result = checkRedirect(response, 'custom_search_menus');
                    if (result.ok) {
                        createdMenus++;
                        ok = true;
                        log(`  ✓ Menu created for row ${row.rowId} (menu id=${result.newId})`, 'green');
                    } else {
                        log(`  ✗ Menu attempt ${attempt} failed for row ${row.rowId} (${result.status})`, 'red');
                    }
                } catch (err) {
                    log(`  ✗ Menu attempt ${attempt} error for row ${row.rowId}: ${err.message}`, 'red');
                }
            }

            if (!ok) failedMenus++;
        }

        log('\n' + '='.repeat(74), 'cyan');
        log('  IMPORT SUMMARY', 'bright');
        log('='.repeat(74), 'cyan');
        log(`Menu Types  -> Created: ${createdTypes}, Failed: ${failedTypes}`, failedTypes > 0 ? 'red' : 'green');
        log(`Menus       -> Created: ${createdMenus}, Failed: ${failedMenus}`, failedMenus > 0 ? 'red' : 'green');
        log(`Mapped rows -> ${rowIdToTypeId.size}`, 'magenta');
        log('='.repeat(74) + '\n', 'cyan');
    } finally {
        await pool.end();
        if (browser) await browser.close();
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    log('\n✗ Missing arguments', 'red');
    log('\nUsage:', 'yellow');
    log('  node scripts/importCustomSearchMenusFromSheet.js <targetOrgId> <xlsxPath> [sheetName]', 'cyan');
    process.exit(1);
}

const targetOrgId = Number(args[0]);
const xlsxPath = args[1];
const sheetName = args[2];

if (Number.isNaN(targetOrgId)) {
    log('\n✗ targetOrgId must be numeric', 'red');
    process.exit(1);
}

if (!fs.existsSync(xlsxPath)) {
    log(`\n✗ File not found: ${xlsxPath}`, 'red');
    process.exit(1);
}

importFromSheet(targetOrgId, xlsxPath, sheetName)
    .then(() => {
        log('✓ Import completed successfully\n', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n✗ Import failed: ${error.message}\n`, 'red');
        console.error(error);
        process.exit(1);
    });
