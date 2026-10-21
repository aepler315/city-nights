import test from 'node:test';
import assert from 'node:assert/strict';
import { Event, TileProviderError } from 'cesium';
import { Observatory } from '../src/world.js';
import { DataStatus } from '../src/data-status.js';

// Network requests are the only double; use real provider events and status logic.
function source(failures = 1, statusCode = 503) {
  let calls = 0;
  const provider = { errorEvent: new Event(), requestImage() {
    calls++;
    return calls <= failures ? Promise.reject(Object.assign(new Error('HTTP failure'), { statusCode })) : Promise.resolve('image');
  } };
  const control = {
    generation: 1, data: new DataStatus(), state: { ready: true },
    viewer: { scene: { requestRender() {} } }, emit() {},
  };
  control.data.begin('satellite'); control.data.connected('satellite');
  Observatory.prototype.trackProvider.call(control, provider, 'requestImage', 'satellite', 1);
  async function request() {
    try { return await provider.requestImage(40, 89, 8); }
    catch (error) {
      const event = new TileProviderError(provider, 'Image failed', 40, 89, 8, 0, error);
      provider.errorEvent.raiseEvent(event);
      return event;
    }
  }
  return { control, provider, request, calls: () => calls, row: () => control.data.snapshot().find(r => r.id === 'satellite') };
}

test('a transient imagery failure retries and then settles without a permanent warning', async () => {
  const s = source();
  assert.equal((await s.request()).retry, true);
  assert.equal(s.row().failed, 0);
  assert.equal(s.row().degraded, false);
  assert.equal(await s.request(), 'image');
  s.control.data.settle('satellite', true);
  assert.equal(s.row().status, 'ready');
  assert.equal(s.row().pending, 0);
});

test('persistent imagery failures stop after two retries and show one unresolved failure', async () => {
  const s = source(10);
  assert.equal((await s.request()).retry, true);
  assert.equal((await s.request()).retry, true);
  assert.equal((await s.request()).retry, false);
  s.control.data.settle('satellite', true);
  assert.equal(s.calls(), 3);
  assert.equal(s.row().status, 'partial');
  assert.equal(s.row().failed, 1);
});

test('permission errors fail immediately instead of repeatedly requesting an inaccessible tile', async () => {
  const s = source(10, 403);
  assert.equal((await s.request()).retry, false);
  assert.equal(s.row().status, 'partial');
  assert.equal(s.row().failed, 1);
});

test('errors from a disconnected provider do not contaminate a new connection', async () => {
  const s = source(10);
  s.control.generation++;
  s.control.data.begin('satellite'); s.control.data.connected('satellite');
  await s.request();
  assert.equal(s.row().failed, 0);
  assert.equal(s.row().degraded, false);
});
