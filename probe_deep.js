const https = require('https');
const B = 'https://customer.jetnetconnect.com';

function req(m, p, b, t) {
  return new Promise(r => {
    const u = new URL(B);
    const d = b ? JSON.stringify(b) : null;
    const o = { hostname: u.hostname, port: 443, path: p, method: m, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } };
    if (d) o.headers['Content-Length'] = Buffer.byteLength(d);
    if (t) o.headers['Authorization'] = 'Bearer ' + t;
    const q = https.request(o, s => {
      let x = '';
      s.on('data', c => x += c);
      s.on('end', () => { try { r({ s: s.statusCode, d: JSON.parse(x) }); } catch { r({ s: s.statusCode, d: x.slice(0, 300) }); } });
    });
    q.on('error', e => r({ s: 0, d: e.message }));
    q.setTimeout(15000, () => { q.destroy(); r({ s: 0, d: 'TIMEOUT' }); });
    if (d) q.write(d);
    q.end();
  });
}

(async () => {
  const l = await req('POST', '/api/Admin/APILogin', { EmailAddress: 'PROD@Advancedaog.com', Password: 'Advancedaog1$' }, null);
  const T = l.d.apiToken, BR = l.d.bearerToken;

  // Account Info
  console.log('=== ACCOUNT INFO ===');
  const ai = await req('GET', '/api/Utility/getAccountInfo/' + T, null, BR);
  console.log(JSON.stringify(ai.d, null, 2));

  // Retry 405s with POST
  console.log('\n=== RETRY 405 ENDPOINTS WITH POST ===\n');
  const eps = [
    ['Make List', '/api/Utility/getAircraftMakeList/' + T],
    ['Model List', '/api/Utility/getAircraftModelList/' + T],
    ['Type List', '/api/Utility/getMakeTypeList/' + T],
    ['Airport List', '/api/Utility/getAirportList/' + T],
    ['State List', '/api/Utility/getStateList/' + T],
    ['Event Categories', '/api/Utility/getEventCategories/' + T],
  ];

  for (const [name, path] of eps) {
    const r = await req('POST', path, {}, BR);
    const ok = r.s >= 200 && r.s < 300;
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} [${r.s}] ${name} (POST)`);
    if (ok && typeof r.d === 'object') {
      const ks = Object.keys(r.d);
      for (const k of ks) {
        if (Array.isArray(r.d[k]) && r.d[k].length > 0) {
          console.log(`   ${r.d[k].length} items | fields: ${Object.keys(r.d[k][0]).join(', ')}`);
          break;
        }
      }
    }
  }

  // Bulk Export field dump
  console.log('\n=== BULK EXPORT: ALL FIELD NAMES ===\n');
  const bx = await req('POST', '/api/Aircraft/getBulkAircraftExportPaged/' + T + '/1/1', { make: 'Gulfstream' }, BR);
  if (bx.d.aircraft && bx.d.aircraft[0]) {
    const fields = Object.keys(bx.d.aircraft[0]);
    console.log(`Total fields: ${fields.length}\n`);
    console.log(fields.join('\n'));
  }
})().catch(console.error);
