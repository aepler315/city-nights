import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStatus } from '../src/data-status.js';

const entry = (data, id) => data.snapshot().find(row => row.id === id);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('an empty request queue does not mark an unconnected dataset ready', () => {
  const data = new DataStatus();
  data.begin('terrain', 'Connecting');
  data.settle('terrain', true);
  assert.equal(entry(data, 'terrain').status, 'connecting');
  data.connected('terrain');
  data.settle('terrain', true);
  assert.equal(entry(data, 'terrain').status, 'ready');
});

test('deferred source work remains visible until the real promise completes', async () => {
  const data = new DataStatus();
  data.begin('satellite'); data.connected('satellite');
  const work = deferred();
  const tracked = data.track('satellite', work.promise);
  data.settle('satellite', true);
  assert.equal(entry(data, 'satellite').pending, 1);
  assert.equal(entry(data, 'satellite').status, 'refining');
  work.resolve('image');
  assert.equal(await tracked, 'image');
  data.settle('satellite', true);
  assert.equal(entry(data, 'satellite').pending, 0);
  assert.equal(entry(data, 'satellite').loaded, 1);
  assert.equal(entry(data, 'satellite').status, 'ready');
});

test('a tile failure stays partial when the queue becomes empty', async () => {
  const data = new DataStatus();
  data.begin('buildings'); data.connected('buildings');
  const tracked = data.track('buildings', Promise.reject(new Error('offline')));
  await assert.rejects(tracked, /offline/);
  data.setQueue('buildings', 0, 0); data.settle('buildings', true);
  assert.equal(entry(data, 'buildings').status, 'partial');
  assert.equal(entry(data, 'buildings').failed, 1);
});

test('reconnecting ignores completion of work from the old provider', async () => {
  const data = new DataStatus();
  data.begin('terrain'); data.connected('terrain');
  const work = deferred(); const tracked = data.track('terrain', work.promise);
  data.begin('terrain'); data.connected('terrain');
  work.resolve('old'); await tracked;
  assert.equal(entry(data, 'terrain').loaded, 0);
  assert.equal(entry(data, 'terrain').pending, 0);
});

test('obsolete view requests cancelled by the map engine do not become source failures', async () => {
  const data = new DataStatus(); data.begin('satellite'); data.connected('satellite');
  const request = { cancelled: false }; const work = deferred();
  const tracked = data.track('satellite', work.promise, () => request.cancelled);
  request.cancelled = true; work.reject(new Error('Request cancelled'));
  await assert.rejects(tracked, /cancelled/);
  data.settle('satellite', true);
  assert.equal(entry(data, 'satellite').pending, 0);
  assert.equal(entry(data, 'satellite').failed, 0);
  assert.equal(entry(data, 'satellite').status, 'ready');
});

test('processing jobs and refinement restart prevent a premature ready state', () => {
  const data = new DataStatus(); data.begin('buildings'); data.connected('buildings');
  data.setQueue('buildings', 0, 2); data.settle('buildings', true);
  assert.equal(entry(data, 'buildings').status, 'refining');
  data.setQueue('buildings', 0, 0); data.settle('buildings', true);
  data.markRefining(['buildings']);
  assert.equal(entry(data, 'buildings').status, 'refining');
});

test('summary distinguishes busy work from settled partial data without a fake percent', () => {
  const data = new DataStatus();
  for (const id of ['terrain','buildings','satellite','nightLights','stars']) { data.begin(id); data.connected(id); data.settle(id, true); }
  assert.equal(data.summary().status, 'ready');
  data.fail('nightLights', 'Optional imagery unavailable', true);
  assert.equal(data.summary().status, 'partial');
  data.markRefining(['terrain']);
  assert.equal(data.summary().status, 'loading');
  assert.equal(data.summary().hasErrors, true);
  assert.equal('percent' in data.summary(), false);
});
