const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCluster(cluster) {
  const lat = finite(cluster?.lat);
  const lng = finite(cluster?.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const aircraft = Array.isArray(cluster.aircraft) ? cluster.aircraft.filter(Boolean) : [];
  return {
    ...cluster,
    lat,
    lng,
    aircraft,
    count: Number(cluster.count) || aircraft.length
  };
}

function normalizeFlight(flight) {
  const lat = finite(flight?.lat);
  const lng = finite(flight?.lng);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { ...flight, lat, lng };
}

function normalizeTrack(track, flight) {
  if (!track || !flight) return null;
  const icao24 = String(track.icao24 || '').trim().toLowerCase();
  if (icao24 && icao24 !== String(flight.icao24 || '').trim().toLowerCase()) return null;
  const path = (Array.isArray(track.path) ? track.path : [])
    .map((point) => {
      const lat = finite(point?.lat);
      const lng = finite(point?.lng);
      if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      return { ...point, lat, lng, onGround: Boolean(point?.onGround) };
    })
    .filter(Boolean);
  return path.length >= 2 ? { ...track, icao24, path } : null;
}

function emptySnapshot(state = 'empty', message = 'No fleet registry snapshot is available yet.') {
  return {
    version: 1,
    state,
    message,
    createdAt: null,
    ageMs: null,
    totalAircraft: 0,
    mappedAircraft: 0,
    clusters: [],
    liveObservation: { state: 'empty', flight: null, track: null, source: 'OpenSky Network' }
  };
}

export class XRFleetDataProvider {
  constructor({ storage = globalThis.localStorage, key = 'mxg_globe_vr_data', staleAfterMs = DEFAULT_STALE_AFTER_MS, now = () => Date.now() } = {}) {
    this.storage = storage;
    this.key = key;
    this.staleAfterMs = staleAfterMs;
    this.now = now;
  }

  read() {
    let payload;
    try {
      const raw = this.storage?.getItem?.(this.key);
      if (!raw) return emptySnapshot();
      payload = JSON.parse(raw);
    } catch (error) {
      return emptySnapshot('error', error?.message || 'The fleet snapshot could not be read.');
    }

    const registry = payload?.registry && typeof payload.registry === 'object' ? payload.registry : payload;
    const clusters = (Array.isArray(registry?.clusters) ? registry.clusters : []).map(normalizeCluster).filter(Boolean);
    const createdAt = payload?.createdAt || registry?.createdAt || null;
    const createdAtMs = Date.parse(createdAt || '');
    const ageMs = Number.isFinite(createdAtMs) ? Math.max(0, this.now() - createdAtMs) : null;
    const declaredState = String(registry?.state || '').toLowerCase();
    const state = ['loading', 'error'].includes(declaredState)
      ? declaredState
      : !clusters.length ? 'empty'
        : ageMs !== null && ageMs > this.staleAfterMs ? 'stale' : 'ready';
    const observationSource = payload?.liveObservation && typeof payload.liveObservation === 'object'
      ? payload.liveObservation
      : { flight: payload?.liveFlight, track: payload?.liveFlightTrack, source: 'OpenSky Network' };
    const flight = normalizeFlight(observationSource.flight);
    const track = normalizeTrack(observationSource.track, flight);

    return {
      version: Number(payload?.version) || 1,
      state,
      message: registry?.message || (state === 'loading'
        ? 'Loading the JetNet fleet registry…'
        : state === 'stale' ? 'Fleet registry snapshot is stale; showing the last known aircraft locations.'
          : state === 'empty' ? 'No mapped JetNet aircraft are available for this workspace.' : ''),
      createdAt,
      ageMs,
      totalAircraft: Number(registry?.totalAircraft) || 0,
      mappedAircraft: Number(registry?.mappedAircraft) || 0,
      clusters,
      liveObservation: {
        state: String(observationSource.state || (flight ? 'ready' : 'empty')),
        flight,
        track,
        source: String(observationSource.source || flight?.source || 'OpenSky Network')
      }
    };
  }
}

export { DEFAULT_STALE_AFTER_MS };
