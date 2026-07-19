/**
 * MXGenius application compatibility client.
 *
 * This is the single browser-side boundary for the current REST/static
 * application sources. It deliberately exposes compatibility DTOs, not the
 * canonical MCP/domain contracts. The post-MCP mount will replace the
 * implementation behind this boundary without rewriting workspace views.
 */
const MXApplicationClient = (() => {
  const API_BASE = 'https://mxg-api.kindbush-8fee3a17.centralus.azurecontainerapps.io';

  async function request(path, options = {}) {
    return fetch(`${API_BASE}${path}`, options);
  }

  async function requestJson(path, options = {}) {
    const response = await request(path, options);
    const data = await response.json();
    return { response, data };
  }

  function jetNetHeaders(bearer) {
    const headers = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return headers;
  }

  async function jetNetJson(path, { bearer, method = 'GET', body } = {}) {
    const options = { method, headers: jetNetHeaders(bearer) };
    if (body !== undefined) options.body = JSON.stringify(body);
    return (await requestJson(`/api/${path}`, options)).data;
  }

  async function adminLogin({ email, password, signal }) {
    return (await requestJson('/api/Admin/APILogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ EmailAddress: email, Password: password }),
      signal
    })).data;
  }

  async function bulkAircraft({ token, bearer, pageSize = 5000, page = 1, cacheTtl }) {
    const path = `/api/Aircraft/getBulkAircraftExportPaged/${token}/${pageSize}/${page}`;
    return MXCache.cachedFetch(
      `${API_BASE}${path}`,
      { method: 'PUT', headers: jetNetHeaders(bearer), body: JSON.stringify({}) },
      cacheTtl
    );
  }

  function aircraftList({ token, bearer, filters = {} }) {
    return jetNetJson(`Aircraft/getAircraftList/${token}`, {
      bearer,
      method: 'PUT',
      body: filters
    });
  }

  async function aircraftBundle({ id, token }) {
    const safeJson = async (promise) => {
      try { return await promise; } catch { return {}; }
    };

    const [aircraft, pictures, engines] = await Promise.all([
      jetNetJson(`Aircraft/getAircraft/${id}/${token}`),
      safeJson(jetNetJson(`Aircraft/getPictures/${id}/${token}`)),
      safeJson(jetNetJson(`Engines/getEnginesByAircraft/${id}/${token}`))
    ]);

    return { aircraft, pictures, engines };
  }

  function companyList({ token, bearer, filters }) {
    return jetNetJson(`Company/getCompanyList/${token}`, {
      bearer,
      method: 'PUT',
      body: filters
    });
  }

  function companyDetail({ id, token }) {
    return jetNetJson(`Company/getCompany/${id}/${token}`);
  }

  function contactList({ token, bearer, filters }) {
    return jetNetJson(`Contact/getContactList/${token}`, {
      bearer,
      method: 'PUT',
      body: filters
    });
  }

  function chat({ message, fleetSignals, apiKey }) {
    return request('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ message, fleet_signals: fleetSignals })
    });
  }

  async function staticJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Static source unavailable (${response.status}): ${path}`);
    return response.json();
  }

  return Object.freeze({
    API_BASE,
    adminLogin,
    aircraftBundle,
    aircraftList,
    bulkAircraft,
    chat,
    companyDetail,
    companyList,
    contactList,
    staticJson
  });
})();

