import { test } from '@playwright/test';
import pool from '../utils/db.js';

const PRODUCT_TYPES = ['diamond', 'gemstone', 'jewelry', 'labgrown_diamond'];
const PRODUCT_KEYS = new Set(PRODUCT_TYPES);
const STOCK_TYPE_MAP = {
  diamond: 'Diamond',
  gemstone: 'Gemstone',
  jewelry: 'Jewelry',
  labgrown_diamond: 'LabGrown',
};

function normalizeStockType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function permissionKey(clientId, vendorId, stockType) {
  return `${clientId}|${vendorId}|${normalizeStockType(stockType)}`;
}

function isRetryableGatewayStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

async function getCompanyById(companyId) {
  const result = await pool.query(
    'SELECT id, organization_id, name FROM companies WHERE id = $1 LIMIT 1',
    [companyId]
  );
  return result.rows[0] || null;
}

async function getExistingApiClient(clientCompanyId) {
  const result = await pool.query(
    `SELECT id, client_id, status FROM api_clients WHERE client_id = $1 LIMIT 1`,
    [clientCompanyId]
  );
  return result.rows[0] || null;
}

async function getExistingPermissionsByClient(clientId) {
  const result = await pool.query(
    `SELECT client_id, vendor_id, stock_type
     FROM inventory_permissions
     WHERE client_id = $1`,
    [clientId]
  );

  const set = new Set(
    result.rows.map((row) => permissionKey(row.client_id, row.vendor_id, row.stock_type))
  );
  console.log(`[DB] Existing permissions for client #${clientId}: ${set.size}`);
  return set;
}

async function findCompanyContributorAdmin(companyId) {
  const result = await pool.query(
    `SELECT id, email, role, company_id
     FROM admin_users
     WHERE company_id = $1
       AND role = 'contributor'
       AND email IS NOT NULL
       AND LOWER(email) LIKE '%@vdbapp.com'
     ORDER BY id ASC
     LIMIT 1`,
    [companyId]
  );
  return result.rows[0] || null;
}

async function getAdminUserById(userId) {
  const result = await pool.query(
    'SELECT id, email, role, company_id FROM admin_users WHERE id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0] || null;
}

async function assertVdbDomainEmail(userId, roleName) {
  const row = await getAdminUserById(userId);
  if (!row) throw new Error(`[VALIDATION] ${roleName} admin_user #${userId} not found`);
  const email = String(row.email || '').trim().toLowerCase();
  if (!email.endsWith('@vdbapp.com')) {
    throw new Error(`[VALIDATION] ${roleName} #${userId} email must be @vdbapp.com (found: ${email})`);
  }
  if (row.role !== 'contributor') {
    throw new Error(`[VALIDATION] ${roleName} #${userId} must be contributor (found: ${row.role})`);
  }
  console.log(`[VALIDATION] ${roleName} #${userId} OK (${email})`);
  return email;
}

function parseCsvIds(rawValue, fieldName) {
  const values = String(rawValue || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`[VALIDATION] ${fieldName} must have at least one ID`);
  const invalid = values.find((v) => !/^\d+$/.test(v));
  if (invalid) throw new Error(`[VALIDATION] ${fieldName} contains invalid ID: "${invalid}"`);
  return [...new Set(values)];
}

function parseProducts(rawValue) {
  const values = String(rawValue || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) return [...PRODUCT_TYPES];
  const invalid = values.find((v) => !PRODUCT_KEYS.has(v));
  if (invalid) throw new Error(`[VALIDATION] Unsupported product "${invalid}"`);
  return [...new Set(values)];
}

async function getSessionFromPage(page, baseUrl) {
  console.log('[SESSION] Logging in to extract CSRF + cookies...');
  await page.goto(`${baseUrl}/superadmin/login`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('textbox', { name: 'Email*' }).fill(process.env.STAGE_SUPERADMIN_EMAIL);
  await page.getByRole('textbox', { name: 'Password*' }).fill(process.env.STAGE_SUPERADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForLoadState('networkidle');

  const csrfToken = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  });
  if (!csrfToken) throw new Error('[SESSION] Could not extract CSRF token from post-login page');
  console.log('[SESSION] CSRF token obtained');

  const cookies = await page.context().cookies();
  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const httpUser = process.env.STAGE_HTTP_USERNAME || 'vdborg001';
  const httpPass = process.env.STAGE_HTTP_PASSWORD || 'letscreateorgs@078';
  const basicAuth = 'Basic ' + Buffer.from(`${httpUser}:${httpPass}`).toString('base64');

  console.log('[SESSION] Session ready');
  return { csrfToken, cookieString, basicAuth };
}

function makeHeaders(session, baseUrl, referer) {
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': session.cookieString,
    'Authorization': session.basicAuth,
    'Origin': baseUrl,
    'Referer': referer || `${baseUrl}/superadmin/inventory_permissions`,
    'X-CSRF-Token': session.csrfToken,
  };
}

async function postCreateApiClient(session, baseUrl, params) {
  const { companyId } = params;
  const url = `${baseUrl}/superadmin/api_clients`;

  const body = new URLSearchParams({
    'utf8': '✓',
    'authenticity_token': session.csrfToken,
    'api_client[client_id]': String(companyId),
    'api_client[status]': 'active',
    'api_client[client_type]': 'vdb_client',
    'api_client[allowed_domains]': 'www.google.com',
    'api_client[allow_stock_types][diamond]': 'true',
    'api_client[allow_stock_types][gemstone]': 'true',
    'api_client[allow_stock_types][jewelry]': 'true',
    'api_client[allow_stock_types][lab_grown_diamond]': 'true',
    'api_client[mark_all_inventory_previewable]': '0',
    'api_client[allow_v2_display_configuration]': '0',
    'api_client[update_webhook_url]': '',
    'api_client[delete_webhook_url]': '',
    'commit': 'Create Api client',
  });

  console.log(`[API CLIENT] POST ${url}`);
  console.log(`[API CLIENT] Body: ${body.toString().slice(0, 800)}`);

  let response = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: makeHeaders(session, baseUrl, `${baseUrl}/superadmin/api_clients/new`),
      body: body.toString(),
      redirect: 'manual',
    });
    if (response.status !== 503) break;
    console.log(`[API CLIENT] HTTP 503 on attempt ${attempt}/3, retrying...`);
    await new Promise((r) => setTimeout(r, attempt * 1500));
  }

  const status = response.status;
  const location = response.headers.get('location') || '';
  console.log(`[API CLIENT] Response: HTTP ${status} Location: ${location}`);

  if (status === 302 || status === 303) {
    const idMatch = location.match(/\/api_clients\/(\d+)/);
    if (idMatch) {
      console.log(`[API CLIENT] Created #${idMatch[1]}`);
      return idMatch[1];
    }

    if (location.includes('/api_clients/new')) {
      const errorPage = await fetch(location, {
        method: 'GET',
        headers: { 'Accept': 'text/html', 'Cookie': session.cookieString, 'Authorization': session.basicAuth },
        redirect: 'follow',
      });
      const errorHtml = await errorPage.text();
      const errorMatch = errorHtml.match(/<div[^>]*class="[^"]*(?:flash_alert|error|alert)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const liErrors = [];
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      while ((liMatch = liRegex.exec(errorHtml)) !== null) {
        const text = liMatch[1].replace(/<[^>]*>/g, '').trim();
        if (text && (text.toLowerCase().includes('error') || text.toLowerCase().includes('blank') || text.toLowerCase().includes('taken') || text.toLowerCase().includes('invalid'))) {
          liErrors.push(text);
        }
      }
      const flashMsg = errorMatch?.[1]?.replace(/<[^>]*>/g, ' ').trim().slice(0, 300) || '';
      const allErrors = [flashMsg, ...liErrors].filter(Boolean).join(' | ');
      console.log(`[API CLIENT] Redirected back to form. Validation errors: ${allErrors || 'unknown (check form fields)'}`);
      throw new Error(`[API CLIENT] Validation failed: ${allErrors || 'redirected back to /new — check required fields'}`);
    }

    if (location.endsWith('/api_clients') || location.endsWith('/api_clients/')) {
      console.log(`[API CLIENT] Created successfully (redirected to index). Looking up ID from DB...`);
      const created = await getExistingApiClient(companyId);
      if (created) {
        console.log(`[API CLIENT] Found in DB: api_client #${created.id}`);
        return String(created.id);
      }
      console.log(`[API CLIENT] Created but could not find ID in DB yet`);
      return null;
    }
  }

  if (status === 200) {
    const html = await response.text().catch(() => '');
    const hasError = html.includes('error') || html.includes('prohibited');
    if (hasError) {
      const errorMatch = html.match(/<div[^>]*class="[^"]*error[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const msg = errorMatch?.[1]?.replace(/<[^>]*>/g, ' ').trim().slice(0, 300) || 'unknown';
      console.log(`[API CLIENT] Validation error: ${msg}`);
      throw new Error(`[API CLIENT] Validation failed: ${msg}`);
    }
    const idMatch = html.match(/\/api_clients\/(\d+)/);
    if (idMatch) {
      console.log(`[API CLIENT] Created #${idMatch[1]}`);
      return idMatch[1];
    }
  }

  const errorBody = await response.text().catch(() => '');
  throw new Error(`[API CLIENT] Failed HTTP ${status}: ${errorBody.slice(0, 300)}`);
}

async function discoverFormFields(session, baseUrl, path) {
  const url = `${baseUrl}${path}`;
  console.log(`[DISCOVER] GET ${url}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'text/html',
      'Cookie': session.cookieString,
      'Authorization': session.basicAuth,
    },
    redirect: 'follow',
  });
  const html = await response.text();

  const fields = [];
  const selectRegex = /<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  let match;
  while ((match = selectRegex.exec(html)) !== null) {
    const name = match[1];
    const optionsHtml = match[2];
    const options = [];
    const optRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let optMatch;
    while ((optMatch = optRegex.exec(optionsHtml)) !== null) {
      options.push({ value: optMatch[1], text: optMatch[2].replace(/<[^>]*>/g, '').trim() });
    }
    fields.push({ type: 'select', name, options });
  }

  const inputRegex = /<input[^>]*name="([^"]+)"[^>]*>/gi;
  while ((match = inputRegex.exec(html)) !== null) {
    const name = match[1];
    const typeMatch = match[0].match(/type="([^"]+)"/);
    const valueMatch = match[0].match(/value="([^"]*)"/);
    fields.push({ type: 'input', name, inputType: typeMatch?.[1] || 'text', value: valueMatch?.[1] || '' });
  }

  console.log(`[DISCOVER] Found ${fields.length} form fields on ${path}`);
  for (const f of fields) {
    if (f.type === 'select') {
      const optPreview = f.options.slice(0, 8).map((o) => `${o.value}:"${o.text}"`).join(', ');
      console.log(`  SELECT name="${f.name}" options=[${optPreview}${f.options.length > 8 ? '...' : ''}]`);
    } else {
      console.log(`  INPUT name="${f.name}" type="${f.inputType}" value="${f.value}"`);
    }
  }
  return fields;
}

async function postCreateInventoryPermission(session, baseUrl, params, formFields) {
  const {
    orgId,
    companyId,
    vendorCompanyId,
    vendorAdminUserId,
    clientAdminUserId,
    productType,
  } = params;

  const url = `${baseUrl}/superadmin/inventory_permissions`;

  const body = new URLSearchParams();
  body.append('utf8', '✓');
  body.append('authenticity_token', session.csrfToken);
  body.append('inventory_permission[organization_id]', String(orgId));
  // Cross-env compatibility: some instances expect client_id, others company_id.
  body.append('inventory_permission[client_id]', String(companyId));
  body.append('inventory_permission[company_id]', String(companyId));
  body.append('inventory_permission[vendor_id]', String(vendorCompanyId));
  if (clientAdminUserId) {
    body.append('inventory_permission[admin_user_id]', String(clientAdminUserId));
  }
  if (vendorAdminUserId) {
    body.append('inventory_permission[vendor_admin_user_id]', String(vendorAdminUserId));
  }
  body.append('inventory_permission[request_status]', 'accepted');
  body.append('inventory_permission[show_cert]', '0');
  body.append('inventory_permission[show_cert]', '1');
  body.append('inventory_permission[inventory_status]', '0');
  body.append('inventory_permission[inventory_status]', '1');
  body.append('inventory_permission[previewable]', '0');
  body.append('inventory_permission[previewable]', '1');
  body.append('inventory_permission[stock_type]', STOCK_TYPE_MAP[productType] || productType);
  body.append('inventory_permission[filters]', '{}');
  body.append('commit', 'Create Inventory permission');

  const stockType = STOCK_TYPE_MAP[productType] || productType;
  console.log(`[PERMISSION] POST ${url} (stock_type=${stockType}, vendor=${vendorCompanyId})`);
  console.log(`[PERMISSION] Body: ${body.toString().slice(0, 800)}`);

  let response = null;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: makeHeaders(session, baseUrl, `${baseUrl}/superadmin/inventory_permissions/new`),
      body: body.toString(),
      redirect: 'manual',
    });
    if (!isRetryableGatewayStatus(response.status)) break;
    if (attempt === maxAttempts) break;
    const waitMs = attempt * 2000;
    console.log(`[PERMISSION] HTTP ${response.status} on attempt ${attempt}/${maxAttempts}, retrying in ${waitMs}ms...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  const status = response.status;
  const location = response.headers.get('location') || '';
  console.log(`[PERMISSION] Response: HTTP ${status} Location: ${location}`);

  if (status === 302 || status === 303) {
    const idMatch = location.match(/\/inventory_permissions\/(\d+)/);
    if (idMatch) {
      const followRes = await fetch(location, {
        method: 'GET',
        headers: {
          'Accept': 'text/html',
          'Cookie': session.cookieString,
          'Authorization': session.basicAuth,
        },
        redirect: 'follow',
      });
      const showHtml = await followRes.text();
      const hasError = showHtml.includes('error') && showHtml.includes('prohibited');
      if (hasError) {
        const errorSnippet = showHtml.match(/prohibited[\s\S]{0,300}/i)?.[0] || '';
        console.log(`[PERMISSION] WARNING: Redirect page contains errors: ${errorSnippet.slice(0, 200)}`);
      }
      console.log(`[PERMISSION] Created #${idMatch[1]} for ${productType}`);
      return idMatch[1];
    }

    const redirectHtml = await fetch(location, {
      method: 'GET',
      headers: { 'Accept': 'text/html', 'Cookie': session.cookieString, 'Authorization': session.basicAuth },
      redirect: 'follow',
    }).then((r) => r.text()).catch(() => '');
    const hasNewForm = redirectHtml.includes('Create Inventory permission') || redirectHtml.includes('inventory_permissions/new');
    if (hasNewForm) {
      const errorMatch = redirectHtml.match(/<div[^>]*class="[^"]*error[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      console.log(`[PERMISSION] FAILED: Redirected back to form. Errors: ${errorMatch?.[1]?.replace(/<[^>]*>/g, ' ').trim().slice(0, 300) || 'unknown'}`);
      throw new Error(`[PERMISSION] Validation failed for ${productType} — redirected back to form`);
    }

    console.log(`[PERMISSION] Redirect to: ${location} (could not extract ID)`);
    return null;
  }

  if (status === 200) {
    const responseHtml = await response.text().catch(() => '');
    const hasError = responseHtml.includes('error') || responseHtml.includes('prohibited');
    if (hasError) {
      const errorMatch = responseHtml.match(/<div[^>]*class="[^"]*error[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const msg = errorMatch?.[1]?.replace(/<[^>]*>/g, ' ').trim().slice(0, 300) || 'unknown validation error';
      console.log(`[PERMISSION] FAILED: ${msg}`);
      throw new Error(`[PERMISSION] Validation failed for ${productType}: ${msg}`);
    }
    const idMatch = responseHtml.match(/inventory_permissions\/(\d+)/);
    if (idMatch) {
      console.log(`[PERMISSION] Created #${idMatch[1]} for ${productType}`);
      return idMatch[1];
    }
    console.log(`[PERMISSION] HTTP 200 but could not find permission ID in response`);
    return null;
  }

  const errorBody = await response.text().catch(() => '');
  throw new Error(`[PERMISSION] Failed HTTP ${status}: ${errorBody.slice(0, 300)}`);
}

async function postUpdatePermissionFlags(session, baseUrl, permissionId) {
  if (!permissionId) return;

  const url = `${baseUrl}/superadmin/inventory_permissions/${permissionId}`;

  const body = new URLSearchParams();
  body.append('utf8', '✓');
  body.append('_method', 'patch');
  body.append('authenticity_token', session.csrfToken);
  body.append('inventory_permission[request_status]', 'accepted');
  body.append('inventory_permission[show_cert]', '0');
  body.append('inventory_permission[show_cert]', '1');
  body.append('inventory_permission[inventory_status]', '0');
  body.append('inventory_permission[inventory_status]', '1');
  body.append('inventory_permission[previewable]', '0');
  body.append('inventory_permission[previewable]', '1');
  body.append('commit', 'Update Inventory permission');

  console.log(`[FLAGS] PATCH ${url}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: makeHeaders(session, baseUrl, `${baseUrl}/superadmin/inventory_permissions/${permissionId}/edit`),
    body: body.toString(),
    redirect: 'manual',
  });

  const status = response.status;
  if (status === 302 || status === 303 || status === 200) {
    console.log(`[FLAGS] Permission #${permissionId} flags updated (HTTP ${status})`);
    return true;
  }

  const errorBody = await response.text().catch(() => '');
  console.log(`[FLAGS] Warning: update failed HTTP ${status}: ${errorBody.slice(0, 200)}`);
  return false;
}

test('create api client + inventory permissions (standalone)', async ({ page }) => {
  const baseUrl = process.env.STAGE_BASE_URL;
  const shouldCreateApiClient = String(process.env.CREATE_API_CLIENT || 'true').toLowerCase() === 'true';
  const companyId = String(process.env.CLIENT_COMPANY_ID || '').trim();
  const vendorCompanyIds = parseCsvIds(process.env.VENDOR_COMPANY_IDS, 'VENDOR_COMPANY_IDS');
  const selectedProducts = parseProducts(process.env.INVENTORY_PRODUCTS);

  if (!baseUrl || !process.env.STAGE_SUPERADMIN_EMAIL || !process.env.STAGE_SUPERADMIN_PASSWORD) {
    throw new Error('Missing env: STAGE_BASE_URL, STAGE_SUPERADMIN_EMAIL, STAGE_SUPERADMIN_PASSWORD');
  }
  if (!companyId || !/^\d+$/.test(companyId)) {
    throw new Error('Missing/invalid env: CLIENT_COMPANY_ID');
  }

  const clientCompany = await getCompanyById(companyId);
  if (!clientCompany) throw new Error(`[VALIDATION] Client company #${companyId} not found`);
  const orgId = String(clientCompany.organization_id);
  console.log(`[VALIDATION] Client company #${companyId} belongs to org #${orgId}`);

  const clientAdmin = await findCompanyContributorAdmin(companyId);
  if (!clientAdmin?.id) {
    throw new Error(`[VALIDATION] No contributor admin_user with @vdbapp.com for client company #${companyId}`);
  }
  await assertVdbDomainEmail(clientAdmin.id, 'Client admin');

  const vendorAdminByVendor = new Map();
  for (const vendorId of vendorCompanyIds) {
    const vendorCompany = await getCompanyById(vendorId);
    if (!vendorCompany) throw new Error(`[VALIDATION] Vendor company #${vendorId} not found`);
    const vendorAdmin = await findCompanyContributorAdmin(vendorId);
    if (!vendorAdmin?.id) {
      console.log(`[VALIDATION] Vendor #${vendorId}: no contributor admin; vendor admin will be null`);
      vendorAdminByVendor.set(vendorId, null);
    } else {
      await assertVdbDomainEmail(vendorAdmin.id, `Vendor admin (${vendorId})`);
      vendorAdminByVendor.set(vendorId, String(vendorAdmin.id));
    }
  }

  let apiClientId = null;
  let needToCreateApiClient = false;
  if (shouldCreateApiClient) {
    const existingApiClient = await getExistingApiClient(companyId);
    if (existingApiClient) {
      console.log(`[API CLIENT] Already exists: api_client #${existingApiClient.id} for client_id=${companyId} (status=${existingApiClient.status})`);
      apiClientId = String(existingApiClient.id);
    } else {
      console.log(`[API CLIENT] No existing api_client for client_id=${companyId} — will create one`);
      needToCreateApiClient = true;
    }
  } else {
    console.log('[API CLIENT] Skipped by request (checkbox unchecked)');
  }

  const existingPermissions = await getExistingPermissionsByClient(companyId);

  const session = await getSessionFromPage(page, baseUrl);

  if (needToCreateApiClient) {
    apiClientId = await postCreateApiClient(session, baseUrl, { orgId, companyId, selectedProducts });
    console.log(`[API CLIENT] Done — apiClientId=${apiClientId}`);
  }

  let formFields = [];
  try {
    formFields = await discoverFormFields(session, baseUrl, '/superadmin/inventory_permissions/new');
    if (formFields.length === 0) {
      console.log('[DISCOVER] Warning: inventory permission new form returned 0 fields (continuing with explicit payload)');
    }
  } catch (err) {
    console.log(`[DISCOVER] Warning: could not discover inventory form fields (${err.message}); continuing with explicit payload`);
  }

  const results = [];
  const skipped = [];
  for (const vendorId of vendorCompanyIds) {
    const vendorAdminUserId = vendorAdminByVendor.get(vendorId);
    for (const productType of selectedProducts) {
      const desiredStockType = STOCK_TYPE_MAP[productType] || productType;
      const key = permissionKey(companyId, vendorId, desiredStockType);
      if (existingPermissions.has(key)) {
        console.log(`[SKIP] Already exists: client=${companyId} vendor=${vendorId} stock_type=${desiredStockType}`);
        skipped.push({ vendorId, productType, reason: 'already_exists' });
        continue;
      }

      const permissionId = await postCreateInventoryPermission(session, baseUrl, {
        orgId,
        companyId,
        vendorCompanyId: vendorId,
        vendorAdminUserId,
        clientAdminUserId: String(clientAdmin.id),
        productType,
      }, formFields);

      await postUpdatePermissionFlags(session, baseUrl, permissionId);
      results.push({ vendorId, productType, permissionId });
      existingPermissions.add(key);

      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log('\n[DONE] ========== INVENTORY PERMISSIONS COMPLETE ==========');
  console.log(`[DONE] API Client ID: ${apiClientId || 'skipped'}`);
  console.log(`[DONE] Permissions created: ${results.length}`);
  console.log(`[DONE] Permissions skipped: ${skipped.length}`);
  for (const r of results) {
    console.log(`[DONE]   vendor=${r.vendorId} product=${r.productType} permission=#${r.permissionId || '?'}`);
  }
  for (const s of skipped) {
    console.log(`[DONE]   skipped vendor=${s.vendorId} product=${s.productType} (${s.reason})`);
  }
  console.log('[DONE] =====================================================');
});
