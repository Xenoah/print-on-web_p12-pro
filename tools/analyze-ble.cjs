#!/usr/bin/env node
'use strict';
// Host-side signal analysis, NOT a Bluetooth/HCI or printer capture.
// Executes the application's real print loop against a deterministic GATT model.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const htmlPath = path.resolve(option('--html', path.join(__dirname, '..', 'index.html')));
const outputPath = option('--output', null);
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const app = script.slice(0, script.indexOf('for(const id of SETTING_IDS)$(id)'));
const init = ['1f1138', '1f11111f11121f11091f1113', '1f1109', '1f11191f1111', '1f1119', '1f1107'];

class VirtualClock {
  constructor() { this.now = 0; this.nextId = 0; this.timers = new Map(); }
  setTimeout(fn, ms = 0) { const id = ++this.nextId; this.timers.set(id, {at: this.now + ms, fn}); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  sleep(ms) { return new Promise(resolve => this.setTimeout(resolve, ms)); }
  async run(task) {
    let done = false, failure;
    task().then(() => { done = true; }, error => { done = true; failure = error; });
    for (let steps = 0; !done; steps++) {
      // Drain native promise continuations before advancing modeled time.
      await new Promise(setImmediate);
      if (done) break;
      assert.ok(steps < 200000, 'simulation failed to terminate');
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      assert.ok(next, 'unresolved operation with no scheduled completion');
      this.timers.delete(next[0]); this.now = next[1].at; next[1].fn();
    }
    if (failure) throw failure;
    assert.equal(this.timers.size, 0, 'timer leak after printing');
  }
}

function makeImage(width, pattern) {
  const pixels = new Uint8ClampedArray(width * 96 * 4).fill(255);
  for (let x = 0; x < width; x++) for (let y = 0; y < 96; y++) {
    const black = pattern === 'solid' || (pattern === 'diagnostic' &&
      (y === 0 || y === 95 || x % 32 === 0 ||
       (y < 16 ? ((x >> Math.floor(y / 2)) & 1) :
        (Math.floor(x / 16) + Math.floor(y / 12)) % 2 === 0)));
    if (black) pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  return {width, height: 96, getContext: () => ({getImageData: () => ({data: pixels})}), pixels};
}
function decodeRaster(bytes, width) {
  // Receiver-side decoding: row-major printer bits back to horizontal canvas.
  const result = new Uint8Array(width * 96);
  for (let row = 0; row < width; row++) for (let head = 0; head < 96; head++) {
    result[(95 - head) * width + row] = ((bytes[row * 12 + (head >> 3)] || 0) >> (7 - (head & 7))) & 1;
  }
  return result;
}

async function capture({width = 400, pattern = 'diagnostic', withResponseMs = 15,
  withoutResponseMs = 15, responseOnly = false, failRasterPacket = 0,
  failAfterDelivery = false, disconnectRasterPacket = 0, stallRasterPacket = 0}) {
  const clock = new VirtualClock(), image = makeImage(width, pattern), elements = new Map();
  const defaults = {copies: '1', length: String(width / (203 / 25.4)), fontFamily: 'sans'};
  const document = {querySelectorAll: () => [], getElementById(id) {
    if (!elements.has(id)) elements.set(id, {value: defaults[id] || '', checked: false,
      style: {}, classList: {toggle() {}}, setAttribute() {}, textContent: ''});
    return elements.get(id);
  }};
  elements.set('preview', image);
  const writes = [], delivered = [];
  let headerSeen = false, rasterRemaining = 0, rasterPackets = 0, active = 0, maxActive = 0, closed = false;
  const device = {name: 'Simulated P12', removeEventListener() {},
    gatt: {connected: true, disconnect() {this.connected = false; closed = true;}}};
  let context;
  async function write(mode, data) {
    assert.ok(device.gatt.connected, 'write attempted after disconnect');
    assert.ok(data.length <= 20, 'ATT minimum-MTU payload exceeded');
    const bytes = Buffer.from(data);
    let phase = 'init';
    if (!headerSeen && bytes[0] === 0x1b && bytes[1] === 0x40) {
      headerSeen = true; rasterRemaining = width * 12; phase = 'header';
    } else if (headerSeen && rasterRemaining > 0) {
      phase = 'raster'; rasterPackets++; rasterRemaining -= bytes.length;
    } else if (headerSeen) phase = 'feed';
    const event = {startMs: clock.now, mode, phase, length: bytes.length, hex: bytes.toString('hex'), success: false};
    writes.push(event); active++; maxActive = Math.max(active, maxActive);
    if (phase === 'raster' && rasterPackets === stallRasterPacket) return new Promise(() => {});
    try {
      await clock.sleep(mode === 'with-response' ? withResponseMs : withoutResponseMs);
      event.endMs = clock.now;
      if (phase === 'raster' && rasterPackets === failRasterPacket) {
        if (failAfterDelivery) delivered.push(event);
        throw new Error('injected GATT failure');
      }
      event.success = true; delivered.push(event);
      if (phase === 'init') clock.setTimeout(() => context.notify(), 2);
      if (phase === 'raster' && rasterPackets === disconnectRasterPacket) context.disconnectForTest();
    } finally { active--; }
  }
  const characteristic = {uuid: '0000ff02-0000-1000-8000-00805f9b34fb',
    properties: {write: true, writeWithoutResponse: !responseOnly},
    writeValueWithResponse: bytes => write('with-response', bytes),
    writeValueWithoutResponse: bytes => write('without-response', bytes)};
  context = vm.createContext({document, device, characteristic, console, navigator: {bluetooth: {}},
    isSecureContext: true, Uint8Array, Uint8ClampedArray, performance: {now: () => clock.now},
    setTimeout: clock.setTimeout.bind(clock), clearTimeout: clock.clearTimeout.bind(clock)});
  vm.runInContext(app + `
    render=()=>{};hasInk=true;renderValid=true;renderedLength=${width / (203 / 25.4)};
    transport=new BleTransport(device);transport.connected=true;transport.writeChar=characteristic;
    const originalTransport=transport;
    globalThis.notify=()=>originalTransport.receive(new Uint8Array([1]));
    globalThis.disconnectForTest=()=>{originalTransport.connected=false;};
    globalThis.run=()=>printLabels();
    globalThis.readState=()=>({busy,connected:!!transport?.connected,logs:[...logLines],waiters:originalTransport.waiters.size,traceCleared:!originalTransport.rasterTrace});
  `, context);
  await clock.run(() => context.run());
  const state = context.readState();
  assert.equal(maxActive, 1, 'overlapping GATT operations');
  assert.equal(state.busy, false);
  assert.equal(state.waiters, 0);
  const failed = Boolean(failRasterPacket || disconnectRasterPacket || stallRasterPacket);
  if (failed) {
    assert.equal(closed, true, 'failure must close the connection');
    assert.equal(writes.some(event => event.phase === 'feed'), false, 'failure must not feed');
    const expectedAttempts = failRasterPacket || disconnectRasterPacket || stallRasterPacket;
    assert.equal(rasterPackets, expectedAttempts, 'failed raster was retried or continued');
  } else {
    assert.equal(closed, false);
    assert.deepEqual(writes.filter(e => e.phase === 'init').map(e => e.hex), init);
    const header = Buffer.concat(writes.filter(e => e.phase === 'header').map(e => Buffer.from(e.hex, 'hex')));
    assert.equal(header.toString('hex', 0, 8), '1b401d7630000c00');
    assert.equal(header.readUInt16LE(8), width);
    assert.equal(writes.filter(e => e.phase === 'feed').map(e => e.hex).join(''), '1b640d1b640d');
    const wire = Buffer.concat(writes.filter(e => e.phase === 'raster').map(e => Buffer.from(e.hex, 'hex')));
    assert.equal(wire.length, width * 12);
    const decoded = decodeRaster(wire, width);
    for (let i = 0; i < decoded.length; i++) assert.equal(decoded[i], image.pixels[i * 4] < 128 ? 1 : 0, `pixel mismatch at ${i}`);
  }
  const raster = writes.filter(e => e.phase === 'raster');
  const first = raster[0].startMs, last = raster.at(-1).endMs;
  if (app.includes('beginRasterTrace(expectedBytes)')) {
    const summary = state.logs.find(line => line.includes('BLE raster host:'));
    assert.ok(summary, 'missing host timing diagnostics');
    const completedBytes = raster.filter(event => event.success).reduce((n, event) => n + event.length, 0);
    assert.ok(summary.includes(`${completedBytes}/${width * 12} bytes, ${raster.length} writes`));
    assert.ok(summary.includes('printer receipt unverified'));
    assert.ok(summary.includes(failed ? 'incomplete' : 'API complete'));
    assert.equal(state.traceCleared, true, 'per-label diagnostics must be released');
    if (!failed) assert.ok(summary.includes(`span ${(last - first).toFixed(1)} ms`));
  }
  return {width, pattern, writes, state, totalMs: clock.now,
    raster: {packets: raster.length, bytes: raster.reduce((n, e) => n + e.length, 0),
      transferMs: last == null ? null : last - first,
      maxGapMs: Math.max(0, ...raster.slice(1).map((e, i) => e.startMs - raster[i].endMs)),
      sha256: crypto.createHash('sha256').update(Buffer.concat(raster.map(e => Buffer.from(e.hex, 'hex')))).digest('hex')},
    delivered};
}

function fifoModel(capture, speedMmPerSec, capacity, prefill) {
  // Hypothesis only: fixed-speed consumer, finite FIFO, no firmware flow control.
  // Full writes arrive at modeled API completion; real arrival times may differ.
  const events = capture.writes.filter(e => e.phase === 'raster');
  const rate = speedMmPerSec * (203 / 25.4) * 12 / 1000;
  let buffered = 0, started = false, last = events[0].endMs, shortage = 0, dropped = 0;
  for (const event of events) {
    if (started) {
      const demand = (event.endMs - last) * rate;
      shortage += Math.max(0, demand - buffered);
      buffered = Math.max(0, buffered - demand);
    }
    const newLevel = buffered + event.length;
    dropped += Math.max(0, newLevel - capacity);
    buffered = Math.min(capacity, newLevel);
    if (!started && buffered >= prefill) started = true;
    last = event.endMs;
  }
  return {speedMmPerSec, capacity, prefill, started,
    starvationMs: Number((shortage / rate).toFixed(2)),
    overflowBytes: Number(dropped.toFixed(2))};
}

(async () => {
  const profiles = [
    {name: 'api-1ms', withResponseMs: 1, withoutResponseMs: 1},
    {name: 'api-7.5ms', withResponseMs: 7.5, withoutResponseMs: 7.5},
    {name: 'api-15ms', withResponseMs: 15, withoutResponseMs: 15},
    {name: 'api-30ms', withResponseMs: 30, withoutResponseMs: 30},
    {name: 'asymmetric-15ms-1ms', withResponseMs: 15, withoutResponseMs: 1},
    {name: 'response-only-15ms', withResponseMs: 15, withoutResponseMs: 1, responseOnly: true}
  ];
  const report = {source: htmlPath, sha256: crypto.createHash('sha256').update(html).digest('hex'),
    kind: 'simulated host API trace, not radio/HCI/printer measurement', profiles: [], invariants: []};
  let sample;
  for (const profile of profiles) {
    const result = await capture(profile);
    report.profiles.push({...profile, ...result.raster,
      bytesPerSec: Number((result.raster.bytes * 1000 / result.raster.transferMs).toFixed(2)),
      fifoHypotheses: [5, 10, 20].flatMap(speed => [64, 256, 1024].map(capacity => fifoModel(result, speed, capacity, Math.min(120, capacity))))});
    if (profile.name === 'api-15ms') sample = result;
  }
  for (const width of [1, 5, 10, 11, 399, 400, 401, 15984]) {
    for (const pattern of ['diagnostic', 'solid', 'blank']) {
      await capture({width, pattern, withResponseMs: 1, withoutResponseMs: 1});
    }
  }
  report.invariants.push('24 image/length cases independently decode pixel-for-pixel (including 2000 mm)');
  report.invariants.push('6 timing/write-mode profiles preserve init/header/raster/feed bytes with serialized writes');
  if (!args.includes('--baseline')) {
    await capture({failRasterPacket: 3});
    await capture({failRasterPacket: 3, failAfterDelivery: true});
    await capture({disconnectRasterPacket: 3});
    await capture({stallRasterPacket: 3});
    report.invariants.push('4 failure cases stop without retry/feed, clear waiters and release busy state');
    if (app.includes('beginRasterTrace(expectedBytes)')) report.invariants.push('host timing/completion diagnostics match the independent capture, including failed and timed-out writes');
  }
  report.sample = {width: sample.width, height: 96,
    raster: sample.writes.filter(e => e.phase === 'raster')};
  const sampleWire = Buffer.concat(report.sample.raster.map(e => Buffer.from(e.hex, 'hex')));
  const droppedIndex = report.sample.raster.findIndex((event, i) => i >= 20 && event.length === 20);
  const lostPacket = Buffer.from(report.sample.raster[droppedIndex].hex, 'hex');
  const before = Buffer.concat(report.sample.raster.slice(0, droppedIndex).map(e => Buffer.from(e.hex, 'hex')));
  const after = Buffer.concat(report.sample.raster.slice(droppedIndex + 1).map(e => Buffer.from(e.hex, 'hex')));
  const corrupted = Buffer.concat([before, after, Buffer.alloc(lostPacket.length)]);
  const expectedPixels = decodeRaster(sampleWire, sample.width), corruptedPixels = decodeRaster(corrupted, sample.width);
  report.lossInjection = {kind: 'synthetic receiver packet omission, not observed loss',
    packetIndex: droppedIndex, omittedBytes: lostPacket.length,
    rowPhaseShiftBytes: lostPacket.length % 12,
    changedPixels: corruptedPixels.reduce((n, bit, i) => n + (bit !== expectedPixels[i]), 0)};
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({kind: report.kind, profiles: report.profiles.map(({fifoHypotheses, ...rest}) => rest),
    invariants: report.invariants, lossInjection: report.lossInjection}, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
