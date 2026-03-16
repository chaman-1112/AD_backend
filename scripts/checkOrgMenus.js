/**
 * Diagnostic: Compare custom_search_menu design_types between two orgs.
 *
 * Usage:
 *   node scripts/checkOrgMenus.js <sourceOrgId> <targetOrgId>
 *   node scripts/checkOrgMenus.js 827 2859
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const DESIGN_TYPE_MAP = {
    0: '(empty/default)', 1: 'rectangular_text_button', 2: 'square_icon_button',
    3: 'bg_square_icon_button', 4: 'round_text_button', 5: 'drop_down',
    6: 'slider', 7: 'rectangular_text_button_with_price', 8: 'drop_down_select',
    9: 'square_icon_button_with_slider', 10: 'square_icon_button_with_bg',
    11: 'square_icon_button_with_slider_and_bg', 12: 'multiselect_checkbox_with_dropdown',
    13: 'checkbox_with_dropdown', 14: 'checkbox', 15: 'center_meas',
    16: 'media_button-compact-no_carousel', 17: 'media_button-labeled-no_carousel',
    18: 'media_button-labeled_2_line-no_carousel', 19: 'media_button-compact-with_carousel',
    20: 'media_button-labeled-with_carousel', 21: 'media_button-labeled_2_line-with_carousel',
    22: 'text_button-dynamic-no_carousel', 23: 'text_button-2_line-no_carousel',
    24: 'text_button-with_price-no_carousel', 25: 'text_button-dynamic-with_carousel',
    26: 'text_button-2_line-with_carousel', 27: 'text_button-with_price-with_carousel',
    28: 'checkbox_button-default-no_carousel', 29: 'checkbox_button-radio-no_carousel',
    30: 'dropdown-default-no_carousel', 31: 'input_filed-measurement-no_carousel',
    32: 'input_filed-range-no_carousel', 33: 'input_filed-default-no_carousel',
    34: 'slider-default-no_carousel', 35: 'slider-range-no_carousel',
};

function extractName(translations) {
    if (!translations) return '(no name)';
    const t = typeof translations === 'string' ? JSON.parse(translations) : translations;
    return t?.en?.name || Object.values(t || {})[0]?.name || '(no name)';
}

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

const id1 = process.argv[2] || '827';
const id2 = process.argv[3] || '2859';

try {
    for (const orgId of [id1, id2]) {
        const { rows: orgRows } = await pool.query(
            `SELECT id, name FROM organizations WHERE id = $1`, [orgId]
        );
        const orgName = orgRows.length > 0 ? orgRows[0].name : 'NOT FOUND';

        console.log(`\n${'='.repeat(90)}`);
        console.log(`  ORG #${orgId}: "${orgName}"`);
        console.log(`${'='.repeat(90)}`);

        // Fetch menus joined with their parent types
        const { rows: menus } = await pool.query(
            `SELECT csm.id AS menu_id, csm.menu_order, csm.custom_search_menu_type_id,
                    t.id AS type_id, t.search_key, t.design_type, t.product_type,
                    t.translations, t.parent_id, t.purpose
             FROM custom_search_menus csm
             JOIN custom_search_menu_types t ON t.id = csm.custom_search_menu_type_id
             WHERE csm.organization_id = $1
             ORDER BY csm.menu_order`,
            [orgId]
        );

        console.log(`\n  PARENT MENU TYPES (linked via custom_search_menus): ${menus.length}\n`);
        console.log(`  ${'#'.padEnd(4)} ${'search_key'.padEnd(25)} ${'design_type'.padEnd(13)} ${'design_name'.padEnd(42)} ${'product_type'.padEnd(13)} type_id`);
        console.log(`  ${'-'.repeat(4)} ${'-'.repeat(25)} ${'-'.repeat(13)} ${'-'.repeat(42)} ${'-'.repeat(13)} ${'-'.repeat(8)}`);

        const parentTypeIds = [];
        for (const m of menus) {
            const dt = m.design_type;
            const dtName = DESIGN_TYPE_MAP[dt] ?? `UNKNOWN(${dt})`;
            const name = m.search_key || extractName(m.translations);
            console.log(`  ${String(m.menu_order).padEnd(4)} ${name.padEnd(25)} ${String(dt).padEnd(13)} ${dtName.padEnd(42)} ${String(m.product_type).padEnd(13)} ${m.type_id}`);
            parentTypeIds.push(m.type_id);
        }

        // Fetch children
        if (parentTypeIds.length > 0) {
            const uniqueParentIds = [...new Set(parentTypeIds)];
            const { rows: children } = await pool.query(
                `SELECT id, search_key, design_type, product_type, translations, parent_id
                 FROM custom_search_menu_types WHERE parent_id = ANY($1::int[])
                 ORDER BY parent_id, id`,
                [uniqueParentIds]
            );

            if (children.length > 0) {
                console.log(`\n  CHILD MENU TYPES: ${children.length}\n`);
                console.log(`  ${'parent'.padEnd(8)} ${'search_key'.padEnd(25)} ${'design_type'.padEnd(13)} ${'design_name'.padEnd(42)} child_id`);
                console.log(`  ${'-'.repeat(8)} ${'-'.repeat(25)} ${'-'.repeat(13)} ${'-'.repeat(42)} ${'-'.repeat(8)}`);
                for (const c of children) {
                    const dt = c.design_type;
                    const dtName = DESIGN_TYPE_MAP[dt] ?? `UNKNOWN(${dt})`;
                    const name = c.search_key || extractName(c.translations);
                    console.log(`  ${String(c.parent_id).padEnd(8)} ${name.padEnd(25)} ${String(dt).padEnd(13)} ${dtName.padEnd(42)} ${c.id}`);
                }
            }
        }
    }

    // Side-by-side comparison
    console.log(`\n${'='.repeat(90)}`);
    console.log(`  DESIGN TYPE MISMATCH REPORT: org ${id1} vs org ${id2}`);
    console.log(`${'='.repeat(90)}\n`);

    // Fetch both with search_key for comparison
    const fetchTypes = async (orgId) => {
        const { rows } = await pool.query(
            `SELECT t.search_key, t.design_type, t.product_type, t.id AS type_id
             FROM custom_search_menus csm
             JOIN custom_search_menu_types t ON t.id = csm.custom_search_menu_type_id
             WHERE csm.organization_id = $1
             ORDER BY t.search_key`,
            [orgId]
        );
        return rows;
    };

    const src = await fetchTypes(id1);
    const tgt = await fetchTypes(id2);

    const srcMap = new Map();
    for (const r of src) srcMap.set(`${r.search_key}|${r.product_type}`, r);
    const tgtMap = new Map();
    for (const r of tgt) tgtMap.set(`${r.search_key}|${r.product_type}`, r);

    let mismatches = 0;
    for (const [key, s] of srcMap) {
        const t = tgtMap.get(key);
        if (!t) {
            console.log(`  MISSING in target: ${key} (source design_type=${s.design_type})`);
            mismatches++;
        } else if (s.design_type !== t.design_type) {
            const srcDt = DESIGN_TYPE_MAP[s.design_type] ?? `UNKNOWN(${s.design_type})`;
            const tgtDt = DESIGN_TYPE_MAP[t.design_type] ?? `UNKNOWN(${t.design_type})`;
            console.log(`  MISMATCH "${key}":`);
            console.log(`    Source (type_id=${s.type_id}): design_type=${s.design_type} → ${srcDt}`);
            console.log(`    Target (type_id=${t.type_id}): design_type=${t.design_type} → ${tgtDt}`);
            mismatches++;
        } else {
            console.log(`  OK: "${key}" design_type=${s.design_type} (matches)`);
        }
    }

    for (const [key] of tgtMap) {
        if (!srcMap.has(key)) {
            const t = tgtMap.get(key);
            console.log(`  EXTRA in target: ${key} (design_type=${t.design_type})`);
            mismatches++;
        }
    }

    console.log(`\n  Total mismatches: ${mismatches}`);
    console.log(`${'='.repeat(90)}\n`);

} catch (err) {
    console.error(`Error: ${err.message}`);
    console.error(err.stack);
} finally {
    pool.end();
}
