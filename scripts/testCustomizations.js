/**
 * Quick test script: Fetch customizations from source org and run
 * only the customizations spec against a target org.
 *
 * Usage:
 *   node scripts/testCustomizations.js <sourceOrgId> <targetOrgId>
 *   node scripts/testCustomizations.js 577 1008
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

dotenv.config({ path: resolve(projectRoot, '.env') });

const sourceOrgId = process.argv[2] || '577';
const targetOrgId = process.argv[3] || '1008';

console.log(`\n  Source Org ID: ${sourceOrgId}`);
console.log(`  Target Org ID: ${targetOrgId}\n`);

// Connect to DB
const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
});

try {
    // Query each (type, product_type) combo: 4 types × 4 product_types = up to 16
    const CUST_TYPES    = ['Pdp', 'SearchResult', 'SearchForm', 'ProductUnifiedPage'];
    const PRODUCT_TYPES = ['1', '2', '3', '4']; // 1=diamond, 2=gemstone, 3=jewelry, 4=lab_grown
    const PRODUCT_LABELS = { '1': 'Diamond', '2': 'Gemstone', '3': 'Jewelry', '4': 'Lab Grown' };

    console.log(`  Querying: all (type × product_type) combos for resource_id = ${sourceOrgId}\n`);

    const rows = [];
    for (const type of CUST_TYPES) {
        for (const pt of PRODUCT_TYPES) {
            const { rows: found } = await pool.query(
                `SELECT * FROM customizations WHERE resource_id = $1 AND type = $2 AND product_type = $3`,
                [sourceOrgId, type, pt]
            );
            if (found.length > 0) {
                rows.push(found[0]);
                console.log(`    FOUND: ${type} | ${PRODUCT_LABELS[pt]} (product_type=${pt}) | id=${found[0].id}`);
            } else {
                console.log(`    ---  : ${type} | ${PRODUCT_LABELS[pt]} (product_type=${pt}) | not found`);
            }
        }
    }

    console.log(`\n  Total: ${rows.length} customizations found (out of ${CUST_TYPES.length * PRODUCT_TYPES.length} possible combos)`);

    // Fetch Global
    console.log(`\n  Querying: global for resource_id = ${sourceOrgId}`);
    const { rows: globals } = await pool.query(
        `SELECT * FROM custom_texts WHERE type = 'Global' AND resource_type = 'Organization' AND resource_id = $1`,
        [sourceOrgId]
    );
    if (globals.length > 0) {
        console.log(`    FOUND: Global (id=${globals[0].id})`);
    } else {
        console.log(`    ---  : No global found`);
    }

    // Fetch JsonNavigationMenu
    console.log(`\n  Querying: JsonNavigationMenu for resource_id = ${sourceOrgId}`);
    const { rows: jsonNavMenuRows } = await pool.query(
        `SELECT * FROM custom_texts WHERE type = 'JsonNavigationMenu' AND resource_type = 'Organization' AND resource_id = $1 LIMIT 1`,
        [sourceOrgId]
    );
    const jsonNavMenu = jsonNavMenuRows.length > 0 ? jsonNavMenuRows[0] : null;
    if (jsonNavMenu) {
        console.log(`    FOUND: JsonNavigationMenu (id=${jsonNavMenu.id})`);
    } else {
        console.log(`    ---  : No JsonNavigationMenu found`);
    }

    // Fetch Custom Texts
    console.log(`\n  Querying: custom texts for resource_id = ${sourceOrgId}`);
    const { rows: customTexts } = await pool.query(
        `SELECT * FROM custom_texts WHERE resource_id = $1 AND resource_type = 'Organization' AND language_id IS NOT NULL ORDER BY language_id`,
        [sourceOrgId]
    );
    if (customTexts.length > 0) {
        for (const ct of customTexts) {
            console.log(`    FOUND: Custom Text (id=${ct.id}) | language_id=${ct.language_id}`);
        }
    } else {
        console.log(`    ---  : No custom texts found`);
    }

    const totalItems = rows.length + globals.length + customTexts.length + (jsonNavMenu ? 1 : 0);
    if (totalItems === 0) {
        console.log('\n  Nothing found for this org. Nothing to do.');
        process.exit(0);
    }

    // Write temp data file
    const tmpDir = resolve(projectRoot, 'tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const dataFile = resolve(tmpDir, `test-customizations-${Date.now()}.json`);
    const data = {
        customizations: rows,
        globals: globals,
        customTexts: customTexts,
        jsonNavMenu: jsonNavMenu,
        overrides: {},
        result: {
            newOrgId: String(targetOrgId),
        },
    };

    writeFileSync(dataFile, JSON.stringify(data, null, 2));
    console.log(`\n  Data file written: ${dataFile}`);

    // Run the unified spec (customizations-only mode: no org/company data, just customizations + orgId)
    console.log(`\n  Running: npx playwright test tests/replication/replicate.spec.js --retries=0\n`);
    console.log('  ' + '='.repeat(60) + '\n');

    const pw = spawn(
        'npx',
        ['playwright', 'test', '--reporter=list', '--retries=0', 'tests/replication/replicate.spec.js'],
        {
            cwd: projectRoot,
            env: {
                ...process.env,
                REPLICATION_DATA_FILE: dataFile,
            },
            shell: true,
            stdio: 'inherit',
        }
    );

    pw.on('close', (code) => {
        console.log(`\n  ${'='.repeat(60)}`);
        console.log(`  Playwright exited with code: ${code}`);
        pool.end();
        process.exit(code);
    });

} catch (err) {
    console.error(`\n  Error: ${err.message}`);
    pool.end();
    process.exit(1);
}
