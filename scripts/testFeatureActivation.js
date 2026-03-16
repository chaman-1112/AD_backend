/**
 * Standalone Feature Activation Test Script
 * 
 * Tests the API-based feature activation system without running full replication
 * 
 * Usage:
 *   node scripts/testFeatureActivation.js <sourceCompanyId> <targetCompanyId>
 * 
 * Example:
 *   node scripts/testFeatureActivation.js 39416 91268
 */

import { chromium } from '@playwright/test';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// ANSI color code
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

async function testFeatureActivation(sourceCompanyId, targetCompanyId) {
    log('\n' + '='.repeat(70), 'cyan');
    log('  FEATURE ACTIVATION TEST SCRIPT', 'bright');
    log('='.repeat(70), 'cyan');
    log(`\nSource Company ID: ${sourceCompanyId}`, 'yellow');
    log(`Target Company ID: ${targetCompanyId}`, 'yellow');
    log(`Base URL: ${process.env.STAGE_BASE_URL}\n`, 'yellow');

    // Database connection
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    let browser;
    let page;

    try {
        // Step 1: Query source company features
        log('Step 1: Fetching features from source company...', 'blue');
        const sourceQuery = `
            SELECT s.feature_id, s.id as settings_id, f.name as feature_name, f.description
            FROM settings s
            JOIN features f ON s.feature_id = f.id
            WHERE s.settable_id = $1 
            AND s.settable_type = 'Company'
            AND s.active = true
            ORDER BY s.feature_id
        `;
        const sourceResult = await pool.query(sourceQuery, [sourceCompanyId]);

        if (sourceResult.rows.length === 0) {
            log('✗ No features found in source company', 'red');
            return;
        }

        log(`✓ Found ${sourceResult.rows.length} features in source company:`, 'green');
        sourceResult.rows.forEach((row, idx) => {
            log(`  ${idx + 1}. ${row.feature_name} (ID: ${row.feature_id})`, 'cyan');
        });

        // Step 2: Query target company features
        log('\nStep 2: Checking target company for matching features...', 'blue');
        const featureIds = sourceResult.rows.map(row => row.feature_id);
        const targetQuery = `
            SELECT s.feature_id, s.id as settings_id, f.name as feature_name, s.active
            FROM settings s
            JOIN features f ON s.feature_id = f.id
            WHERE s.settable_id = $1 
            AND s.settable_type = 'Company'
            AND s.feature_id = ANY($2::int[])
            AND (s.active = false OR s.active IS NULL)
            ORDER BY s.feature_id
        `;
        const targetResult = await pool.query(targetQuery, [targetCompanyId, featureIds]);

        const alreadyActive = sourceResult.rows.length - targetResult.rows.length;
        
        if (targetResult.rows.length === 0) {
            log(`✓ All ${sourceResult.rows.length} features are already active in target company!`, 'green');
            log('Nothing to activate - all features already enabled.', 'yellow');
            return;
        }

        if (alreadyActive > 0) {
            log(`✓ ${alreadyActive} features already active (skipping those)`, 'yellow');
        }
        log(`✓ Found ${targetResult.rows.length} inactive features to activate in target company`, 'green');

        // Step 3: Launch browser and login
        log('\nStep 3: Launching browser and logging in...', 'blue');
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({
            httpCredentials: {
                username: process.env.STAGE_DATA_HTTP_USERNAME,
                password: process.env.STAGE_DATA_HTTP_PASSWORD,
            },
        });
        page = await context.newPage();

        // Login
        const baseUrl = process.env.STAGE_BASE_URL;
        await page.goto(`${baseUrl}/superadmin/login`, { waitUntil: 'networkidle' });
        
        await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
        await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
        await page.getByRole('button', { name: 'Login' }).click();
        await page.waitForLoadState('networkidle');
        log('✓ Logged in successfully', 'green');

        // Get CSRF token
        log('\nStep 3b: Fetching CSRF token...', 'blue');
        await page.goto(`${baseUrl}/superadmin/company_settings?q%5Bsettable_id_eq%5D=${targetCompanyId}`, {
            waitUntil: 'networkidle',
        });
        
        const csrfToken = await page.evaluate(() => {
            const metaTag = document.querySelector('meta[name="csrf-token"]');
            return metaTag ? metaTag.getAttribute('content') : '';
        });
        
        if (!csrfToken) {
            log('✗ Could not find CSRF token', 'red');
            throw new Error('CSRF token not found');
        }
        
        log(`✓ CSRF token obtained: ${csrfToken.substring(0, 20)}...`, 'green');

        // Get cookies
        const cookies = await context.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        // Step 4: Activate features
        log('\nStep 4: Activating features via API...', 'blue');
        log('-'.repeat(70), 'cyan');

        let activated = 0;
        let failed = 0;

        for (const setting of targetResult.rows) {
            const url = `${baseUrl}/superadmin/company_settings/${setting.settings_id}/enable`;

            try {
                log(`\n→ Activating: ${setting.feature_name}`, 'yellow');
                log(`  Feature ID: ${setting.feature_id}`, 'cyan');
                log(`  Settings ID: ${setting.settings_id}`, 'cyan');
                log(`  URL: ${url}`, 'cyan');

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': cookieString,
                        'Origin': baseUrl,
                        'Referer': `${baseUrl}/superadmin/company_settings?q%5Bsettable_id_eq%5D=${targetCompanyId}`,
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                    },
                    body: `_method=put&authenticity_token=${encodeURIComponent(csrfToken)}`,
                    redirect: 'manual',
                });

                if (response.ok || response.status === 302 || response.status === 303) {
                    log(`✓ SUCCESS (HTTP ${response.status})`, 'green');
                    activated++;
                } else {
                    const responseText = await response.text().catch(() => 'Could not read response');
                    log(`✗ FAILED (HTTP ${response.status})`, 'red');
                    if (response.status === 404) {
                        log(`  Response: Feature may already be active or endpoint not found`, 'yellow');
                    }
                    failed++;
                }

                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (error) {
                log(`✗ ERROR: ${error.message}`, 'red');
                failed++;
            }
        }

        // Summary
        log('\n' + '='.repeat(70), 'cyan');
        log('  TEST SUMMARY', 'bright');
        log('='.repeat(70), 'cyan');
        log(`Total Features: ${targetResult.rows.length}`, 'yellow');
        log(`✓ Activated: ${activated}`, 'green');
        log(`✗ Failed: ${failed}`, 'red');
        log(`Success Rate: ${((activated / targetResult.rows.length) * 100).toFixed(1)}%`, 'magenta');
        log('='.repeat(70) + '\n', 'cyan');

    } catch (error) {
        log(`\n✗ Fatal Error: ${error.message}`, 'red');
        console.error(error);
    } finally {
        await pool.end();
        if (browser) {
            await browser.close();
        }
    }
}

// Main execution
const args = process.argv.slice(2);

if (args.length < 2) {
    log('\n✗ Error: Missing required arguments', 'red');
    log('\nUsage:', 'yellow');
    log('  node scripts/testFeatureActivation.js <sourceCompanyId> <targetCompanyId>', 'cyan');
    log('\nExample:', 'yellow');
    log('  node scripts/testFeatureActivation.js 39416 91268', 'cyan');
    process.exit(1);
}

const [sourceCompanyId, targetCompanyId] = args.map(Number);

if (isNaN(sourceCompanyId) || isNaN(targetCompanyId)) {
    log('\n✗ Error: Company IDs must be numbers', 'red');
    process.exit(1);
}

testFeatureActivation(sourceCompanyId, targetCompanyId)
    .then(() => {
        log('✓ Test completed successfully\n', 'green');
        process.exit(0);
    })
    .catch((error) => {
        log(`\n✗ Test failed: ${error.message}\n`, 'red');
        process.exit(1);
    });
