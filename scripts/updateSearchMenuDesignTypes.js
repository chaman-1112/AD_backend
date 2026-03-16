/**
 * Update custom_search_menu_types design_type on the destination org
 * to match the source org. Reads the actual selected value from the
 * source's edit page and applies it to the destination's edit page.
 *
 * Matches parent menu types by (search_key, product_type) and
 * children by (search_key) under the matched parent.
 *
 * Usage:
 *   node scripts/updateSearchMenuDesignTypes.js <sourceOrgId> <destinationOrgId>
 *
 * Example:
 *   node scripts/updateSearchMenuDesignTypes.js 827 2859
 */

import pg from 'pg';
import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const colors = {
    reset: '\x1b[0m', bright: '\x1b[1m',
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
    blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};
function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
    log('\nUsage:', 'yellow');
    log('  node scripts/updateSearchMenuDesignTypes.js <sourceOrgId> <destinationOrgId>', 'cyan');
    log('\nExample:', 'yellow');
    log('  node scripts/updateSearchMenuDesignTypes.js 827 2859\n', 'cyan');
    process.exit(1);
}

const [sourceOrgId, destOrgId] = args.map(Number);
if (isNaN(sourceOrgId) || isNaN(destOrgId)) {
    log('\nError: Org IDs must be numbers\n', 'red');
    process.exit(1);
}
if (sourceOrgId === destOrgId) {
    log('\nError: Source and destination cannot be the same\n', 'red');
    process.exit(1);
}

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

const baseUrl = process.env.STAGE_BASE_URL;

function extractName(translations) {
    if (!translations) return '(no name)';
    const t = typeof translations === 'string' ? JSON.parse(translations) : translations;
    return t?.en?.name || Object.values(t || {})[0]?.name || '(no name)';
}

async function fetchMenuData(orgId) {
    const { rows: parents } = await pool.query(
        `SELECT csm.id AS menu_id, csm.menu_order,
                t.id AS type_id, t.search_key, t.design_type, t.product_type, t.translations
         FROM custom_search_menus csm
         JOIN custom_search_menu_types t ON t.id = csm.custom_search_menu_type_id
         WHERE csm.organization_id = $1
         ORDER BY csm.menu_order`,
        [orgId]
    );

    const parentTypeIds = [...new Set(parents.map(p => p.type_id))];
    let children = [];
    if (parentTypeIds.length > 0) {
        const { rows } = await pool.query(
            `SELECT id, search_key, design_type, product_type, translations, parent_id
             FROM custom_search_menu_types WHERE parent_id = ANY($1::int[])
             ORDER BY parent_id, id`,
            [parentTypeIds]
        );
        children = rows;
    }

    return { parents, children };
}

// ── Browser helpers ──

async function loginAndGetPage() {
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

    return { browser, page };
}

async function readDesignType(page, typeId) {
    await page.goto(`${baseUrl}/superadmin/custom_search_menu_types/${typeId}/edit`, { waitUntil: 'networkidle' });
    const select = page.locator('#custom_search_menu_type_design_type');
    if (await select.count() === 0) return null;
    return await select.inputValue();
}

async function updateDesignType(page, typeId, newValue) {
    await page.goto(`${baseUrl}/superadmin/custom_search_menu_types/${typeId}/edit`, { waitUntil: 'networkidle' });
    const select = page.locator('#custom_search_menu_type_design_type');
    if (await select.count() === 0) return false;

    const currentValue = await select.inputValue();
    if (currentValue === newValue) return true;

    await select.selectOption(newValue);
    await page.waitForTimeout(300);

    const submitBtn = page.getByRole('button', { name: /update/i });
    if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await page.waitForLoadState('networkidle');
    } else {
        const form = page.locator('form');
        await form.evaluate(f => f.submit());
        await page.waitForLoadState('networkidle');
    }

    return true;
}

// ── Main ──

let browser;
try {
    // Verify orgs
    const { rows: srcOrg } = await pool.query('SELECT id, name FROM organizations WHERE id = $1', [sourceOrgId]);
    const { rows: dstOrg } = await pool.query('SELECT id, name FROM organizations WHERE id = $1', [destOrgId]);

    if (srcOrg.length === 0) { log(`\nError: Source org #${sourceOrgId} not found\n`, 'red'); process.exit(1); }
    if (dstOrg.length === 0) { log(`\nError: Destination org #${destOrgId} not found\n`, 'red'); process.exit(1); }

    log('\n' + '='.repeat(70), 'cyan');
    log('  UPDATE CUSTOM SEARCH MENU DESIGN TYPES', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\n  Source:      #${sourceOrgId} "${srcOrg[0].name}"`, 'yellow');
    log(`  Destination: #${destOrgId} "${dstOrg[0].name}"`, 'yellow');

    const src = await fetchMenuData(sourceOrgId);
    const dst = await fetchMenuData(destOrgId);

    log(`\n  Source parents: ${src.parents.length} | children: ${src.children.length}`, 'cyan');
    log(`  Dest   parents: ${dst.parents.length} | children: ${dst.children.length}`, 'cyan');

    // Build match maps
    const srcParentMap = new Map();
    for (const p of src.parents) srcParentMap.set(`${p.search_key}|${p.product_type}`, p);
    const dstParentMap = new Map();
    for (const p of dst.parents) dstParentMap.set(`${p.search_key}|${p.product_type}`, p);

    // Collect all type pairs that need checking (source_type_id → dest_type_id)
    const parentTypeMapping = new Map();
    const typePairsToCheck = [];

    for (const [key, s] of srcParentMap) {
        const d = dstParentMap.get(key);
        if (!d) continue;
        parentTypeMapping.set(s.type_id, d.type_id);
        if (s.design_type !== d.design_type) {
            typePairsToCheck.push({
                srcTypeId: s.type_id,
                dstTypeId: d.type_id,
                label: s.search_key || extractName(s.translations),
                kind: 'parent',
                srcDt: s.design_type,
                dstDt: d.design_type,
            });
        }
    }

    // Match children
    const srcChildrenByParent = new Map();
    for (const c of src.children) {
        if (!srcChildrenByParent.has(c.parent_id)) srcChildrenByParent.set(c.parent_id, []);
        srcChildrenByParent.get(c.parent_id).push(c);
    }
    const dstChildrenByParent = new Map();
    for (const c of dst.children) {
        if (!dstChildrenByParent.has(c.parent_id)) dstChildrenByParent.set(c.parent_id, []);
        dstChildrenByParent.get(c.parent_id).push(c);
    }

    for (const [srcParentId, dstParentId] of parentTypeMapping) {
        const srcKids = srcChildrenByParent.get(srcParentId) || [];
        const dstKids = dstChildrenByParent.get(dstParentId) || [];
        const dstKidMap = new Map();
        for (const k of dstKids) dstKidMap.set(k.search_key || extractName(k.translations), k);

        for (const sc of srcKids) {
            const childName = sc.search_key || extractName(sc.translations);
            const dc = dstKidMap.get(childName);
            if (!dc) continue;
            if (sc.design_type !== dc.design_type) {
                typePairsToCheck.push({
                    srcTypeId: sc.id,
                    dstTypeId: dc.id,
                    label: childName,
                    kind: `child (parent ${srcParentId}→${dstParentId})`,
                    srcDt: sc.design_type,
                    dstDt: dc.design_type,
                });
            }
        }
    }

    if (typePairsToCheck.length === 0) {
        log('\n  No design_type mismatches found — everything already matches!', 'green');
        log('='.repeat(70) + '\n', 'cyan');
        process.exit(0);
    }

    log(`\n  Found ${typePairsToCheck.length} design_type mismatch(es) to fix\n`, 'yellow');

    // Launch browser
    log('  Launching browser and logging in...', 'blue');
    const session = await loginAndGetPage();
    browser = session.browser;
    const { page } = session;
    log('  Logged in successfully\n', 'green');

    log('-'.repeat(70), 'cyan');

    let updated = 0;
    let failed = 0;

    for (const pair of typePairsToCheck) {
        log(`\n  [${pair.kind}] "${pair.label}"`, 'yellow');
        log(`    DB mismatch: source=${pair.srcDt} dest=${pair.dstDt}`, 'cyan');

        // Read the actual selected design_type string from source's edit page
        log(`    Reading source type #${pair.srcTypeId} edit page...`, 'blue');
        const srcValue = await readDesignType(page, pair.srcTypeId);

        if (srcValue === null) {
            log(`    SKIP — could not read source design_type select`, 'red');
            failed++;
            continue;
        }
        log(`    Source form value: "${srcValue}"`, 'cyan');

        // Read current destination value
        log(`    Reading dest type #${pair.dstTypeId} edit page...`, 'blue');
        const dstValue = await readDesignType(page, pair.dstTypeId);
        log(`    Dest form value:   "${dstValue}"`, 'cyan');

        if (srcValue === dstValue) {
            log(`    Already matching in the form — skipping`, 'green');
            continue;
        }

        // Update destination
        log(`    Updating dest type #${pair.dstTypeId}: "${dstValue}" → "${srcValue}"`, 'yellow');
        const ok = await updateDesignType(page, pair.dstTypeId, srcValue);

        if (ok) {
            log(`    Updated successfully`, 'green');
            updated++;
        } else {
            log(`    FAILED to update`, 'red');
            failed++;
        }
    }

    // Summary
    log('\n' + '='.repeat(70), 'cyan');
    log('  SUMMARY', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\n  Updated: ${updated}`, updated > 0 ? 'green' : 'yellow');
    log(`  Failed:  ${failed}`, failed > 0 ? 'red' : 'green');
    log(`  Total mismatches checked: ${typePairsToCheck.length}`, 'cyan');
    log('='.repeat(70) + '\n', 'cyan');

} catch (err) {
    log(`\nError: ${err.message}`, 'red');
    console.error(err.stack);
} finally {
    pool.end();
    if (browser) await browser.close();
}
