import { getCsrfToken } from './getCsrfToken.js';

// const CLOUDFRONT_BASE = 'https://d4e0znfezoh8f.cloudfront.net/uploads/custom_search_menu_type';

const CLOUDFRONT_BASE = 'https://d24ppbhzdyfrur.cloudfront.net/uploads/custom_search_menu_type';


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

async function downloadIcon(type, rowId, filename) {
    if (!filename || !filename.trim()) return null;
    const url = `${CLOUDFRONT_BASE}/${type}/${rowId}/${filename}`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.log(`[SEARCH MENU]     ⚠ Could not download ${type} (${res.status}): ${url}`);
            return null;
        }
        const arrayBuf = await res.arrayBuffer();
        const mimeType = type === 'png_icon' ? 'image/png' : 'image/svg+xml';
        return { name: filename, mimeType, buffer: Buffer.from(arrayBuf) };
    } catch (err) {
        console.log(`[SEARCH MENU]     ⚠ Download error for ${type}: ${err.message}`);
        return null;
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
        console.log(`[SEARCH MENU]     ⚠ design_type fix failed: ${err.message}`);
        return false;
    }
}

async function postMenuType(page, csrf, baseUrl, menuType, parentId, pngPayload, svgPayload) {
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

async function postSearchMenu(page, csrf, baseUrl, targetOrgId, menu, mappedTypeId) {
    return page.request.post(
        `${baseUrl}/superadmin/custom_search_menus`,
        {
            multipart: {
                'utf8': '✓',
                'authenticity_token': csrf,
                'custom_search_menu[scope_type]': 'Organization',
                'custom_search_menu[organization_id]': String(targetOrgId),
                'custom_search_menu[custom_search_menu_type_id]': String(mappedTypeId),
                'custom_search_menu[menu_order]': String(menu.menu_order ?? 0),
                'commit': 'Create Custom search menu',
            },
            maxRedirects: 0,
        }
    );
}

async function createWithRetry(page, baseUrl, label, createFn) {
    let csrf = await getCsrfToken(page, baseUrl);
    try {
        const response = await createFn(csrf);
        return response;
    } catch (err) {
        console.log(`[SEARCH MENU]     ✗ ${label} error: ${err.message}, retrying...`);
    }

    csrf = await getCsrfToken(page, baseUrl);
    return createFn(csrf);
}

/**
 * Copy custom search menu types (parents + children with images) and
 * custom search menus from one org to another.
 * Uses the existing logged-in Playwright page — no separate browser session.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('pg').Pool} pool
 * @param {string} baseUrl
 * @param {number} sourceOrgId
 * @param {number} targetOrgId
 * @returns {Promise<{createdTypes: number, createdMenus: number, failedTypes: number, failedMenus: number}>}
 */
export async function copyCustomSearchMenus(page, pool, baseUrl, sourceOrgId, targetOrgId) {
    console.log(`\n[SEARCH MENU] ========== CUSTOM SEARCH MENU COPY ==========`);
    console.log(`[SEARCH MENU] Source Org: ${sourceOrgId} → Target Org: ${targetOrgId}`);

    const { rows: parents } = await pool.query(
        `SELECT * FROM custom_search_menu_types
         WHERE id IN (
             SELECT custom_search_menu_type_id
             FROM custom_search_menus WHERE organization_id = $1
         )`,
        [sourceOrgId]
    );
    const parentIds = parents.map(p => p.id);

    let children = [];
    if (parentIds.length > 0) {
        const childResult = await pool.query(
            `SELECT * FROM custom_search_menu_types WHERE parent_id = ANY($1::int[])`,
            [parentIds]
        );
        children = childResult.rows;
    }

    const { rows: menus } = await pool.query(
        `SELECT * FROM custom_search_menus WHERE organization_id = $1`,
        [sourceOrgId]
    );

    const total = parents.length + children.length + menus.length;
    console.log(`[SEARCH MENU] Parents: ${parents.length} | Children: ${children.length} | Menus: ${menus.length} | Total: ${total}`);

    if (total === 0) {
        console.log(`[SEARCH MENU] Nothing to copy — skipping`);
        return { createdTypes: 0, createdMenus: 0, failedTypes: 0, failedMenus: 0 };
    }

    const typeIdMapping = new Map();
    let createdTypes = 0;
    let createdMenus = 0;
    let failedTypes = 0;
    let failedMenus = 0;

    // Create parent menu types
    console.log(`[SEARCH MENU] Creating ${parents.length} parent menu type(s)...`);
    for (const parent of parents) {
        const names = extractTranslationNames(parent.translations);
        const label = names.en || parent.search_key;
        console.log(`[SEARCH MENU]   → "${label}" (id=${parent.id})`);

        const [pngPayload, svgPayload] = await Promise.all([
            downloadIcon('png_icon', parent.id, parent.png_icon),
            downloadIcon('svg_icon', parent.id, parent.svg_icon),
        ]);

        try {
            const response = await createWithRetry(page, baseUrl, label,
                (csrf) => postMenuType(page, csrf, baseUrl, parent, null, pngPayload, svgPayload)
            );
            const result = checkRedirect(response, 'custom_search_menu_types');
            if (result.ok) {
                typeIdMapping.set(parent.id, result.newId);
                console.log(`[SEARCH MENU]     ✓ Created → new id=${result.newId}`);
                createdTypes++;

                const fixed = await fixDesignType(page, baseUrl, parent.id, result.newId);
                if (fixed) console.log(`[SEARCH MENU]     ✓ design_type synced from source`);
            } else {
                console.log(`[SEARCH MENU]     ✗ FAIL (${result.status})`);
                failedTypes++;
            }
        } catch (err) {
            console.log(`[SEARCH MENU]     ✗ ERROR: ${err.message}`);
            failedTypes++;
        }
    }

    // Create child menu types
    if (children.length > 0) {
        console.log(`[SEARCH MENU] Creating ${children.length} child menu type(s)...`);
        for (const child of children) {
            const names = extractTranslationNames(child.translations);
            const label = names.en || child.search_key;
            const mappedParentId = typeIdMapping.get(child.parent_id);

            if (!mappedParentId) {
                console.log(`[SEARCH MENU]   → "${label}" — SKIPPED (parent ${child.parent_id} not mapped)`);
                failedTypes++;
                continue;
            }

            console.log(`[SEARCH MENU]   → "${label}" (id=${child.id}, parent=${child.parent_id}→${mappedParentId})`);

            const [pngPayload, svgPayload] = await Promise.all([
                downloadIcon('png_icon', child.id, child.png_icon),
                downloadIcon('svg_icon', child.id, child.svg_icon),
            ]);

            try {
                const response = await createWithRetry(page, baseUrl, label,
                    (csrf) => postMenuType(page, csrf, baseUrl, child, mappedParentId, pngPayload, svgPayload)
                );
                const result = checkRedirect(response, 'custom_search_menu_types');
                if (result.ok) {
                    typeIdMapping.set(child.id, result.newId);
                    console.log(`[SEARCH MENU]     ✓ Created → new id=${result.newId}`);
                    createdTypes++;

                    const fixed = await fixDesignType(page, baseUrl, child.id, result.newId);
                    if (fixed) console.log(`[SEARCH MENU]     ✓ design_type synced from source`);
                } else {
                    console.log(`[SEARCH MENU]     ✗ FAIL (${result.status})`);
                    failedTypes++;
                }
            } catch (err) {
                console.log(`[SEARCH MENU]     ✗ ERROR: ${err.message}`);
                failedTypes++;
            }
        }
    }

    // Create custom search menus
    if (menus.length > 0) {
        console.log(`[SEARCH MENU] Creating ${menus.length} custom search menu(s)...`);
        for (const menu of menus) {
            const mappedTypeId = typeIdMapping.get(menu.custom_search_menu_type_id);

            if (!mappedTypeId) {
                console.log(`[SEARCH MENU]   → menu id=${menu.id} — SKIPPED (type ${menu.custom_search_menu_type_id} not mapped)`);
                failedMenus++;
                continue;
            }

            console.log(`[SEARCH MENU]   → menu id=${menu.id} type=${menu.custom_search_menu_type_id}→${mappedTypeId}`);

            try {
                const response = await createWithRetry(page, baseUrl, `menu-${menu.id}`,
                    (csrf) => postSearchMenu(page, csrf, baseUrl, targetOrgId, menu, mappedTypeId)
                );
                const result = checkRedirect(response, 'custom_search_menus');
                if (result.ok) {
                    console.log(`[SEARCH MENU]     ✓ Created → new id=${result.newId}`);
                    createdMenus++;
                } else {
                    console.log(`[SEARCH MENU]     ✗ FAIL (${result.status})`);
                    failedMenus++;
                }
            } catch (err) {
                console.log(`[SEARCH MENU]     ✗ ERROR: ${err.message}`);
                failedMenus++;
            }
        }
    }

    console.log(`[SEARCH MENU] Complete: types=${createdTypes} created/${failedTypes} failed | menus=${createdMenus} created/${failedMenus} failed`);
    console.log(`[SEARCH MENU] ================================================\n`);

    if (failedTypes > 0 || failedMenus > 0) {
        throw new Error(`Custom search menu copy incomplete: failedTypes=${failedTypes}, failedMenus=${failedMenus}`);
    }

    return { createdTypes, createdMenus, failedTypes, failedMenus };
}
