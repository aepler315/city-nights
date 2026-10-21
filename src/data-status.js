const DATASETS = [
  ['terrain', 'Terrain'], ['buildings', '3D buildings'], ['satellite', 'Satellite imagery'],
  ['nightLights', 'Night-light imagery'], ['stars', 'Star catalog'],
];

/** Tracks real source work. Queue counts are snapshots, never percent complete. */
export class DataStatus {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.rows = new Map(DATASETS.map(([id, label]) => [id, {
      id, label, status: 'waiting', connected: false, pending: 0, processing: 0,
      loaded: 0, failed: 0, degraded: false, detail: 'Waiting to connect', epoch: 0,
    }]));
  }

  change(id, values) {
    const row = this.rows.get(id);
    if (!row) throw new RangeError(`Unknown dataset: ${id}`);
    if (!Object.entries(values).some(([key, value]) => row[key] !== value)) return;
    Object.assign(row, values);
    this.onChange();
  }

  begin(id, detail = 'Connecting to source') {
    this.change(id, { status: 'connecting', connected: false, pending: 0, processing: 0,
      loaded: 0, failed: 0, degraded: false, detail, epoch: this.rows.get(id).epoch + 1 });
  }

  connected(id, detail = 'Source connected · preparing view') {
    this.change(id, { connected: true, status: 'refining', detail });
  }

  setQueue(id, pending, processing = 0) {
    const row = this.rows.get(id);
    this.change(id, { pending: Math.max(0, pending), processing: Math.max(0, processing),
      ...(row.connected && !row.degraded && (pending || processing) ? { status: 'refining' } : {}) });
  }

  loaded(id) {
    this.change(id, { loaded: this.rows.get(id).loaded + 1 });
  }

  fail(id, detail, fatal = false) {
    const row = this.rows.get(id);
    this.change(id, { status: fatal ? 'unavailable' : 'partial', failed: row.failed + 1, degraded: true,
      detail, ...(fatal ? { connected: false, pending: 0, processing: 0 } : {}) });
  }

  warn(id, detail) {
    this.change(id, { status: 'partial', degraded: true, detail });
  }

  markRefining(ids = DATASETS.map(([id]) => id), detail = 'Refining the current view') {
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row.connected && !row.degraded) this.change(id, { status: 'refining', detail });
    }
  }

  settle(id, sourceReady, detail = 'Ready for the current view') {
    const row = this.rows.get(id);
    if (!row.connected) return;
    if (row.degraded) { this.change(id, { status: 'partial' }); return; }
    const ready = sourceReady && row.pending === 0 && row.processing === 0;
    this.change(id, { status: ready ? 'ready' : 'refining', detail: ready ? detail : 'Loading and refining the current view' });
  }

  track(id, result, isCancelled = () => false) {
    // Cesium returns undefined when its scheduler defers a request. That is
    // queued work, not an in-flight transfer and not a completed tile.
    if (result === undefined) return result;
    const row = this.rows.get(id);
    const epoch = row.epoch;
    if (!result || typeof result.then !== 'function') { this.loaded(id); return result; }
    this.setQueue(id, row.pending + 1, row.processing);
    return Promise.resolve(result).then(value => {
      const current = this.rows.get(id);
      if (current.epoch === epoch) {
        this.setQueue(id, current.pending - 1, current.processing);
        this.loaded(id);
      }
      return value;
    }, error => {
      const current = this.rows.get(id);
      if (current.epoch === epoch) {
        this.setQueue(id, current.pending - 1, current.processing);
        if (!isCancelled()) this.fail(id, 'Source request failed · reconnect to retry');
      }
      throw error;
    });
  }

  snapshot() {
    return [...this.rows.values()].map(row => ({ ...row }));
  }

  summary() {
    const rows = this.snapshot();
    const busy = rows.filter(row => ['waiting', 'connecting', 'loading', 'refining'].includes(row.status));
    const hasErrors = rows.some(row => row.degraded || row.status === 'unavailable');
    return {
      status: busy.length ? 'loading' : hasErrors ? 'partial' : 'ready',
      busy: busy.length, hasErrors,
      pending: rows.reduce((sum, row) => sum + row.pending, 0),
      processing: rows.reduce((sum, row) => sum + row.processing, 0),
      loaded: rows.reduce((sum, row) => sum + row.loaded, 0),
    };
  }
}
