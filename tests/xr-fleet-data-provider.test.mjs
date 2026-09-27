import assert from 'node:assert/strict';
import test from 'node:test';
import { XRFleetDataProvider } from '../xr-fleet-data-provider.js';

function storage(value, { throws = false } = {}) {
  return {
    getItem() {
      if (throws) throw new Error('storage blocked');
      return value === null ? null : JSON.stringify(value);
    }
  };
}

test('XR fleet provider keeps JetNet registry and public live observation separate', () => {
  const now = Date.parse('2026-09-27T14:00:00Z');
  const provider = new XRFleetDataProvider({
    storage: storage({
      version: 4,
      createdAt: '2026-09-27T13:59:00Z',
      registry: {
        state: 'ready',
        totalAircraft: 1,
        mappedAircraft: 1,
        clusters: [{ icao: 'KPBI', lat: 26.68, lng: -80.09, aircraft: [{ aircraftid: 7, regnbr: 'N7MX' }] }]
      },
      liveObservation: {
        state: 'ready',
        source: 'OpenSky Network',
        flight: { icao24: 'abc123', lat: 26.7, lng: -80.1 },
        track: {
          icao24: 'abc123',
          departureObserved: true,
          path: [{ lat: 25.8, lng: -80.3, onGround: true }, { lat: 26.7, lng: -80.1 }]
        }
      }
    }),
    now: () => now
  });
  const result = provider.read();
  assert.equal(result.state, 'ready');
  assert.equal(result.clusters[0].aircraft[0].regnbr, 'N7MX');
  assert.equal(result.liveObservation.source, 'OpenSky Network');
  assert.equal(result.liveObservation.track.path.length, 2);
  assert.equal('flight' in result.clusters[0], false);
});

test('XR fleet provider marks aged cache stale without hiding its aircraft', () => {
  const provider = new XRFleetDataProvider({
    storage: storage({
      createdAt: '2026-09-27T12:00:00Z',
      registry: { clusters: [{ icao: 'KJFK', lat: 40.6, lng: -73.7, aircraft: [] }] }
    }),
    staleAfterMs: 60_000,
    now: () => Date.parse('2026-09-27T14:00:00Z')
  });
  const result = provider.read();
  assert.equal(result.state, 'stale');
  assert.equal(result.clusters.length, 1);
  assert.match(result.message, /stale/i);
});

test('XR fleet provider exposes empty and error states without throwing', () => {
  assert.equal(new XRFleetDataProvider({ storage: storage(null) }).read().state, 'empty');
  const failed = new XRFleetDataProvider({ storage: storage(null, { throws: true }) }).read();
  assert.equal(failed.state, 'error');
  assert.match(failed.message, /storage blocked/);
});
