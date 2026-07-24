/**
 * MXGenius — JetNet API Tier Probe
 * 
 * Authenticates directly with JetNet (no proxy needed) and tests
 * every known endpoint to discover what's available on our tier.
 * 
 * Run:  node probe_jetnet.js
 */

const https = require('https');

const JETNET_BASE = 'https://customer.jetnetconnect.com';
const CREDS = {
  EmailAddress: 'PROD@Advancedaog.com',
  Password: 'Advancedaog1$',
};

// ─── HTTP Helper ───────────────────────────────────
function request(method, path, body, bearer) {
  return new Promise((resolve, reject) => {
    const url = new URL(JETNET_BASE);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: 443,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    if (bearer) opts.headers['Authorization'] = `Bearer ${bearer}`;

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data.slice(0, 500) });
        }
      });
    });
    req.on('error', e => resolve({ status: 0, data: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, data: 'TIMEOUT' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Probe ─────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  MXGenius — JetNet API Tier Discovery Probe');
  console.log('═══════════════════════════════════════════════\n');

  // Step 1: Login
  console.log('🔑 Authenticating...');
  const login = await request('POST', '/api/Admin/APILogin', CREDS, null);
  if (!login.data.bearerToken || !login.data.apiToken) {
    console.log('❌ Login failed:', login.data);
    return;
  }
  const BEARER = login.data.bearerToken;
  const TOKEN = login.data.apiToken;
  console.log(`✅ Authenticated. Token: ${TOKEN.slice(0, 20)}...`);
  console.log(`   Service: ${login.data.serviceType || '?'}  Frequency: ${login.data.frequency || '?'}\n`);

  // Step 2: Probe all endpoints
  const results = [];

  async function probe(label, method, path, body) {
    const fullPath = path.replace(/{TOKEN}/g, TOKEN);
    const res = await request(method, fullPath, body, BEARER);
    const ok = res.status >= 200 && res.status < 300;
    const d = res.data;

    let shape = '—';
    let count = '—';
    if (ok && typeof d === 'object') {
      const keys = Object.keys(d);
      shape = keys.slice(0, 8).join(', ');
      // Try to find array data
      for (const k of keys) {
        if (Array.isArray(d[k])) {
          count = `${d[k].length} items`;
          if (d[k].length > 0) {
            const sample = d[k][0];
            const sampleKeys = Object.keys(sample);
            shape = `${k}[]: ${sampleKeys.length} fields → ${sampleKeys.slice(0, 10).join(', ')}`;
            if (sampleKeys.length > 10) shape += `, ... +${sampleKeys.length - 10} more`;
          }
          break;
        }
      }
      if (count === '—' && d.count !== undefined) count = `count: ${d.count}`;
    }

    const icon = ok ? '✅' : '❌';
    results.push({ label, status: res.status, ok, count, shape });
    console.log(`${icon} [${res.status}] ${label}`);
    if (ok) console.log(`   ${count} | ${shape}`);
    else console.log(`   ${typeof d === 'string' ? d.slice(0, 100) : JSON.stringify(d).slice(0, 100)}`);
  }

  console.log('\n── UTILITY ENDPOINTS ──────────────────────────\n');

  await probe('Account Info',
    'GET', '/api/Utility/getAccountInfo/{TOKEN}', null);

  await probe('Aircraft Make List',
    'GET', '/api/Utility/getAircraftMakeList/{TOKEN}', null);

  await probe('Aircraft Model List',
    'GET', '/api/Utility/getAircraftModelList/{TOKEN}', null);

  await probe('Make Type List',
    'GET', '/api/Utility/getMakeTypeList/{TOKEN}', null);

  await probe('Airframe Types',
    'GET', '/api/Utility/getAirframeTypes/{TOKEN}', null);

  await probe('Event Categories',
    'GET', '/api/Utility/getEventCategories/{TOKEN}', null);

  await probe('Event Types',
    'GET', '/api/Utility/getEventTypes/{TOKEN}', null);

  await probe('Airport List',
    'GET', '/api/Utility/getAirportList/{TOKEN}', null);

  await probe('Country List',
    'GET', '/api/Utility/getCountryList/{TOKEN}', null);

  await probe('State List',
    'GET', '/api/Utility/getStateList/{TOKEN}', null);

  await probe('Company Business Types',
    'GET', '/api/Utility/getCompanyBusinessTypes/{TOKEN}', null);

  console.log('\n── AIRCRAFT ENDPOINTS ─────────────────────────\n');

  await probe('Aircraft List (small query)',
    'POST', '/api/Aircraft/getAircraftList/{TOKEN}',
    { make: 'Gulfstream', pageSize: 5 });

  await probe('Aircraft Event List',
    'POST', '/api/Utility/getAircraftEventList/{TOKEN}',
    { make: 'Gulfstream', pageSize: 5 });

  await probe('Bulk Aircraft Export',
    'POST', '/api/Aircraft/getBulkAircraftExport/{TOKEN}',
    { make: 'Gulfstream', pageSize: 2 });

  await probe('Bulk Aircraft Export Paged',
    'POST', '/api/Aircraft/getBulkAircraftExportPaged/{TOKEN}/2/1',
    { make: 'Gulfstream' });

  await probe('Get All Aircraft Objects',
    'POST', '/api/Aircraft/getAllAircraftObjects/{TOKEN}',
    { aircraftIds: [1] });

  await probe('History List Paged',
    'POST', '/api/Aircraft/getHistoryListPaged/{TOKEN}/5/1', {});

  console.log('\n── COMPANY / CONTACT ENDPOINTS ────────────────\n');

  await probe('Company List',
    'POST', '/api/Company/getCompanyList/{TOKEN}',
    { pageSize: 3 });

  await probe('Contact List',
    'POST', '/api/Contact/getContactList/{TOKEN}',
    { pageSize: 3 });

  // ─── Summary ───────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('  TIER SUMMARY');
  console.log('═══════════════════════════════════════════════\n');

  const available = results.filter(r => r.ok);
  const blocked = results.filter(r => !r.ok);

  console.log(`✅ Available: ${available.length}/${results.length} endpoints\n`);
  available.forEach(r => console.log(`   ✅ ${r.label} (${r.count})`));

  if (blocked.length > 0) {
    console.log(`\n❌ Blocked/Unavailable: ${blocked.length}\n`);
    blocked.forEach(r => console.log(`   ❌ ${r.label} → HTTP ${r.status}`));
  }

  console.log('\n═══════════════════════════════════════════════\n');
}

main().catch(console.error);
