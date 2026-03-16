/**
 * Standalone Org White Label Copy Script
 *
 * Copies white label configurations from one org to another.
 * Reads from theme_white_labelings and uploads JSON per platform
 * via multipart POST (in-memory buffer, no temp files).
 *
 * Usage:
 *   node scripts/copyOrgWhiteLabel.js <sourceOrgId> <targetOrgId>
 *
 * Example:
 *   node scripts/copyOrgWhiteLabel.js 832 945
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

async function fetchWhiteLabelRows(pool, orgId) {
    const { rows } = await pool.query(
        `SELECT platform, config_data
         FROM theme_white_labelings
         WHERE resource_type = 'Organization'
           AND resource_id = $1`,
        [orgId]
    );
    return rows;
}

function buildFilePayload(configData, platform) {
    const jsonStr = typeof configData === 'string'
        ? configData
        : JSON.stringify(configData);
    return {
        name: `${platform}_white_label.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(jsonStr, 'utf-8'),
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error) {
    const msg = String(error?.message || '');
    return (
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('EAI_AGAIN')
    );
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

async function readCsrfFromPage(page) {
    return page.evaluate(() =>
        document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    );
}

async function getCsrfToken(page, baseUrl) {
    // Try current page first in case token is already available.
    let csrf = await readCsrfFromPage(page);
    if (csrf) return csrf;

    const csrfPages = [
        `${baseUrl}/superadmin/organizations`,
        `${baseUrl}/superadmin/theme_white_labelings`,
    ];

    for (const url of csrfPages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        csrf = await readCsrfFromPage(page);
        if (csrf) return csrf;
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/superadmin/login')) {
        throw new Error('Could not obtain CSRF token: session appears logged out');
    }

    throw new Error(`Could not obtain CSRF token (current page: ${currentUrl})`);
}

async function uploadWhiteLabel(page, csrf, baseUrl, targetOrgId, platform, filePayload) {
    return page.request.post(
        `${baseUrl}/superadmin/theme_white_labelings`,
        {
            multipart: {
                'utf8': '✓',
                'authenticity_token': csrf,
                'theme_white_labeling[resource_type]': 'Organization',
                'theme_white_labeling[resource_id]': String(targetOrgId),
                'theme_white_labeling[config_version]': '0',
                'theme_white_labeling[file_upload]': filePayload,
                'theme_white_labeling[platform]': String(platform),
                'commit': 'Create Theme white labeling',
            },
            maxRedirects: 0,
            timeout: 45000,
        }
    );
}

function isSuccessRedirect(response) {
    const status = response.status();
    const location = response.headers()['location'] || '';
    const redirectedToRecord = /\/theme_white_labelings\/\d+/.test(location);
    if (status === 302 && redirectedToRecord) {
        return { ok: true, status, location };
    }
    return { ok: false, status, location };
}

async function copyOrgWhiteLabel(sourceOrgId, targetOrgId) {
    log('\n' + '='.repeat(70), 'cyan');
    log('  ORG WHITE LABEL COPY SCRIPT', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\nSource Org ID: ${sourceOrgId}`, 'yellow');
    log(`Target Org ID: ${targetOrgId}`, 'yellow');
    log(`Base URL: ${process.env.STAGE_BASE_URL}\n`, 'yellow');

    const pool = createPool();
    let browser;

    try {
        // Step 1: Verify orgs
        log('Step 1: Verifying organizations...', 'blue');

        const { rows: srcOrg } = await pool.query(
            'SELECT id, name FROM organizations WHERE id = $1', [sourceOrgId]
        );
        if (srcOrg.length === 0) throw new Error(`Source org #${sourceOrgId} not found`);
        log(`  ✓ Source: "${srcOrg[0].name}" (#${srcOrg[0].id})`, 'green');

        const { rows: tgtOrg } = await pool.query(
            'SELECT id, name FROM organizations WHERE id = $1', [targetOrgId]
        );
        if (tgtOrg.length === 0) throw new Error(`Target org #${targetOrgId} not found`);
        log(`  ✓ Target: "${tgtOrg[0].name}" (#${tgtOrg[0].id})`, 'green');

        // Step 2: Fetch white label rows from source
        log('\nStep 2: Fetching white label data from source org...', 'blue');
        const rows = await fetchWhiteLabelRows(pool, sourceOrgId);

        if (rows.length === 0) {
            log('\n  ✗ No white label configurations found — nothing to copy.', 'yellow');
            return;
        }

        log(`  Found ${rows.length} platform(s):`, 'green');
        for (const r of rows) {
            const size = typeof r.config_data === 'string'
                ? r.config_data.length
                : JSON.stringify(r.config_data).length;
            log(`    → ${r.platform} (${size} chars)`, 'cyan');
        }

        // Step 3: Launch browser and login
        log('\nStep 3: Launching browser and logging in...', 'blue');
        const baseUrl = process.env.STAGE_BASE_URL;
        const session = await loginAndGetPage(baseUrl);
        browser = session.browser;
        const { page } = session;
        log('  ✓ Logged in successfully', 'green');

        // Step 4: Get CSRF token
        log('\nStep 4: Fetching CSRF token...', 'blue');
        let csrf = await getCsrfToken(page, baseUrl);
        log(`  ✓ CSRF token obtained: ${csrf.substring(0, 20)}...`, 'green');

        // Step 5: Upload each platform's white label
        log('\nStep 5: Uploading white label configs...', 'blue');
        log('-'.repeat(70), 'cyan');

        let created = 0;
        let failed = 0;

        for (const row of rows) {
            const { platform, config_data } = row;
            const filePayload = buildFilePayload(config_data, platform);
            const platformLabel = platform === 0 || platform === '0' ? 'Web' : 'Mobile';
            log(`\n→ ${platformLabel} (platform=${platform}, ${filePayload.buffer.length} bytes)`, 'yellow');

            // Fresh CSRF before every upload to avoid token consumption issues
            csrf = await getCsrfToken(page, baseUrl);

            let ok = false;
            let lastError = null;
            const maxAttempts = 4;

            for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
                if (attempt > 1) {
                    const delayMs = attempt * 2000;
                    log(`  Retry ${attempt - 1}/${maxAttempts - 1} with fresh CSRF after ${delayMs}ms...`, 'yellow');
                    await sleep(delayMs);
                    csrf = await getCsrfToken(page, baseUrl);
                }

                try {
                    const response = await uploadWhiteLabel(
                        page, csrf, baseUrl, targetOrgId, platform, filePayload
                    );
                    const result = isSuccessRedirect(response);
                    log(`  status=${result.status} location=${result.location}`, 'cyan');
                    if (result.ok) {
                        log(`  ✓ OK (${result.status}) → ${result.location}`, 'green');
                        ok = true;
                        created++;
                    } else {
                        const body = await response.text().catch(() => '');
                        log(`  ✗ FAIL (${result.status})`, 'red');
                        if (body) log(`  Response: ${body.substring(0, 300)}`, 'red');
                    }
                } catch (err) {
                    lastError = err;
                    log(`  ✗ ERROR: ${err.message}`, 'red');
                    if (!isTransientNetworkError(err)) {
                        break;
                    }
                }
            }

            if (!ok) {
                if (lastError) {
                    log(`  Final error after retries: ${lastError.message}`, 'red');
                }
                failed++;
            }
        }

        // Summary
        log('\n' + '='.repeat(70), 'cyan');
        log('  COPY SUMMARY', 'bright');
        log('='.repeat(70), 'cyan');
        log(`Source Org: "${srcOrg[0].name}" (#${sourceOrgId})`, 'yellow');
        log(`Target Org: "${tgtOrg[0].name}" (#${targetOrgId})`, 'yellow');
        log(`Platforms:  ${rows.length}`, 'yellow');
        log(`  ✓ Created: ${created}`, 'green');
        log(`  ✗ Failed:  ${failed}`, failed > 0 ? 'red' : 'green');
        log(`Success Rate: ${((created / rows.length) * 100).toFixed(1)}%`, 'magenta');
        log('='.repeat(70) + '\n', 'cyan');

        if (failed > 0) {
            throw new Error(`White label copy incomplete: ${failed} platform(s) failed`);
        }

    } catch (error) {
        log(`\n✗ Fatal Error: ${error.message}`, 'red');
        console.error(error);
        throw error;
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
    log('  node scripts/copyOrgWhiteLabel.js <sourceOrgId> <targetOrgId>', 'cyan');
    log('\nExample:', 'yellow');
    log('  node scripts/copyOrgWhiteLabel.js 832 945', 'cyan');
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

copyOrgWhiteLabel(sourceOrgId, targetOrgId)
    .then(() => {
        log('✓ Script completed successfully\n', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n✗ Script failed: ${error.message}\n`, 'red');
        process.exit(1);
    });
