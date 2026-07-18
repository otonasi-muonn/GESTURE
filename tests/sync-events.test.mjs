import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const syncSource = await readFile(new URL('../src/sync.js', import.meta.url), 'utf8');
const rulesSource = await readFile(new URL('../src/sync-rules.js', import.meta.url), 'utf8');
const rules = await import(`data:text/javascript;base64,${Buffer.from(rulesSource).toString('base64')}`);
let fixtureNumber = 0;

class FakeEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event, payload) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

class FakeElement {
  constructor() {
    this.className = '';
    this.classList = { add() {}, remove() {} };
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
  }

  addEventListener(event, listener) {
    this.listeners.set(event, listener);
  }

  querySelector(selector) {
    return this.children?.[selector] ?? null;
  }

  click() {
    this.listeners.get('click')?.({ stopPropagation() {} });
  }
}

function createTimers() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      scheduled.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      scheduled.delete(id);
    },
    delays() {
      return Array.from(scheduled.values(), ({ delay }) => delay);
    },
    runNext() {
      const entry = scheduled.entries().next().value;
      assert.ok(entry, '実行可能なタイマーが必要です');
      const [id, { callback }] = entry;
      scheduled.delete(id);
      callback();
    },
    get size() {
      return scheduled.size;
    }
  };
}

async function createFixture() {
  const timers = createTimers();
  const peers = [];
  const button = new FakeElement();
  const syncStatus = new FakeElement();
  syncStatus.children = {
    '.sync-icon': new FakeElement(),
    '.sync-text': new FakeElement()
  };
  const elements = new Map([
    ['btn-take-control', button],
    ['sync-status', syncStatus]
  ]);
  const document = {
    readyState: 'complete',
    getElementById(id) {
      return elements.get(id) ?? null;
    }
  };

  class FakeConnection extends FakeEmitter {
    constructor(owner = null) {
      super();
      this.owner = owner;
      this.open = false;
      this.closed = false;
      this.sent = [];
    }

    send(payload) {
      this.sent.push(payload);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.emit('close');
      this.emit('error', new Error('close cleanup'));
    }
  }

  class FakePeer extends FakeEmitter {
    constructor(id) {
      super();
      this.id = id;
      this.destroyed = false;
      this.disconnected = false;
      this.reconnectCalls = 0;
      this.connections = [];
      peers.push(this);
    }

    connect(targetId) {
      const connection = new FakeConnection(this);
      connection.peer = targetId;
      this.connections.push(connection);
      this.lastConnection = connection;
      return connection;
    }

    reconnect() {
      this.reconnectCalls += 1;
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.connections.forEach((connection) => connection.close());
      this.emit('close');
      this.emit('error', new Error('destroy cleanup'));
    }
  }

  const state = {
    syncRole: 'loading',
    currentScreen: 'HOME',
    activeCategory: null,
    solvedWords: new Set(),
    hands: []
  };
  const deps = {
    state,
    elCameraContainer: { style: {} },
    initMediaPipe() {},
    stopMediaPipe() {},
    refreshRoleUI() {},
    CATEGORIES: [{ id: 1, words: ['one'] }],
    MAX_TAKEOVER_CLAIM_ATTEMPTS: rules.MAX_TAKEOVER_CLAIM_ATTEMPTS,
    shouldAttemptTakeoverClaim: rules.shouldAttemptTakeoverClaim,
    Peer: FakePeer,
    document,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout
  };
  globalThis.__syncTestDeps = deps;
  const withoutImports = syncSource.replace(/^import .*;\r?\n/gm, '');
  const prelude = `const {
    state, elCameraContainer, initMediaPipe, stopMediaPipe, refreshRoleUI,
    CATEGORIES, MAX_TAKEOVER_CLAIM_ATTEMPTS, shouldAttemptTakeoverClaim,
    Peer, document, setTimeout, clearTimeout
  } = globalThis.__syncTestDeps;\n`;
  const fixtureSource = `${prelude}${withoutImports}\n// fixture ${++fixtureNumber}`;
  const sync = await import(`data:text/javascript;base64,${Buffer.from(fixtureSource).toString('base64')}`);

  function startAsViewer() {
    sync.initSync();
    const initialSender = peers.at(-1);
    initialSender.emit('error', { type: 'unavailable-id' });
    assert.equal(state.syncRole, 'viewer');
    assert.equal(timers.size, 0, '初回 unavailable-id はタイマーを使いません');
    const viewer = peers.at(-1);
    viewer.emit('open', 'viewer-id');
    const connection = viewer.lastConnection;
    connection.open = true;
    connection.emit('open');
    return { initialSender, viewer, connection };
  }

  return { sync, state, peers, button, timers, FakeConnection, startAsViewer };
}

test('takeover 中の viewer connection close/error は claim attempt 1 のタイマーを上書きしない', async () => {
  const fixture = await createFixture();
  const { connection } = fixture.startAsViewer();

  fixture.button.click();
  assert.deepEqual(fixture.timers.delays(), [500]);
  connection.emit('close');
  connection.emit('error', new Error('release race'));

  assert.deepEqual(fixture.timers.delays(), [500]);
  fixture.timers.runNext();
  assert.equal(fixture.peers.at(-1).id, fixture.sync.MASTER_PEER_ID);
});

test('claim 開始時の destroy が発火する旧 close/error を無視してタイマーを増やさない', async () => {
  const fixture = await createFixture();
  fixture.startAsViewer();
  fixture.button.click();

  fixture.timers.runNext();

  assert.equal(fixture.peers.at(-1).id, fixture.sync.MASTER_PEER_ID);
  assert.equal(fixture.timers.size, 0);
});

test('sender は不正な data を無視した後も正規の release 要求を処理する', async () => {
  const fixture = await createFixture();
  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const senderConnection = new fixture.FakeConnection(sender);
  sender.emit('connection', senderConnection);

  assert.doesNotThrow(() => {
    senderConnection.emit('data', null);
    senderConnection.emit('data', 'REQUEST_RELEASE_SENDER');
    senderConnection.emit('data', {});
  });
  senderConnection.emit('data', { type: 'REQUEST_RELEASE_SENDER' });

  assert.equal(sender.destroyed, true);
  assert.equal(fixture.state.syncRole, 'viewer');
});

test('release 後に旧 sender が viewer 接続へ失敗しても、console error なしで再試行する', async (t) => {
  const fixture = await createFixture();
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args);
  t.after(() => { console.error = originalConsoleError; });

  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const senderConnection = new fixture.FakeConnection(sender);
  sender.emit('connection', senderConnection);
  senderConnection.emit('data', { type: 'REQUEST_RELEASE_SENDER' });

  const viewer = fixture.peers.at(-1);
  viewer.emit('open', 'former-sender-viewer-id');
  viewer.lastConnection.emit('error', new Error('Could not connect to peer'));

  assert.deepEqual(fixture.timers.delays(), [2000]);
  assert.equal(consoleErrors.length, 0);
  fixture.timers.runNext();
  assert.notEqual(fixture.peers.at(-1), viewer);
});

test('release 後でも viewer 接続成立後の error は console error に出す', async (t) => {
  const fixture = await createFixture();
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args);
  t.after(() => { console.error = originalConsoleError; });

  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const senderConnection = new fixture.FakeConnection(sender);
  sender.emit('connection', senderConnection);
  senderConnection.emit('data', { type: 'REQUEST_RELEASE_SENDER' });

  const viewer = fixture.peers.at(-1);
  viewer.emit('open', 'former-sender-viewer-id');
  viewer.lastConnection.open = true;
  viewer.lastConnection.emit('open');
  viewer.lastConnection.emit('error', new Error('connection dropped after open'));

  assert.equal(consoleErrors.length, 1);
  assert.deepEqual(fixture.timers.delays(), [2000]);
});

test('release 直後の viewer peer-unavailable は console error なしで再試行する', async (t) => {
  const fixture = await createFixture();
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args);
  t.after(() => { console.error = originalConsoleError; });

  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const senderConnection = new fixture.FakeConnection(sender);
  sender.emit('connection', senderConnection);
  senderConnection.emit('data', { type: 'REQUEST_RELEASE_SENDER' });

  const viewer = fixture.peers.at(-1);
  viewer.emit('open', 'former-sender-viewer-id');
  viewer.emit('error', { type: 'peer-unavailable' });

  assert.equal(consoleErrors.length, 0);
  assert.deepEqual(fixture.timers.delays(), [3000]);
  fixture.timers.runNext();
  assert.notEqual(fixture.peers.at(-1), viewer);
});

test('release 直後でも peer-unavailable 以外の viewer peer error は console error に出す', async (t) => {
  const fixture = await createFixture();
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args);
  t.after(() => { console.error = originalConsoleError; });

  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const senderConnection = new fixture.FakeConnection(sender);
  sender.emit('connection', senderConnection);
  senderConnection.emit('data', { type: 'REQUEST_RELEASE_SENDER' });

  const viewer = fixture.peers.at(-1);
  viewer.emit('open', 'former-sender-viewer-id');
  viewer.emit('error', { type: 'network' });

  assert.equal(consoleErrors.length, 1);
  assert.deepEqual(fixture.timers.delays(), [3000]);
});

test('release 後に接続確立した viewer の peer-unavailable は console error に出す', async (t) => {
  const fixture = await createFixture();
  const originalConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => consoleErrors.push(args);
  t.after(() => { console.error = originalConsoleError; });

  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const senderConnection = new fixture.FakeConnection(sender);
  sender.emit('connection', senderConnection);
  senderConnection.emit('data', { type: 'REQUEST_RELEASE_SENDER' });

  const viewer = fixture.peers.at(-1);
  viewer.emit('open', 'former-sender-viewer-id');
  viewer.lastConnection.open = true;
  viewer.lastConnection.emit('open');
  viewer.emit('error', { type: 'peer-unavailable' });

  assert.equal(consoleErrors.length, 1);
  assert.deepEqual(fixture.timers.delays(), [3000]);
});

test('初回 unavailable-id は即 viewer、takeover は claim 1〜3 の後に viewer へ戻り attempt 4 を作らない', async () => {
  const fixture = await createFixture();
  fixture.startAsViewer();
  const peersBeforeTakeover = fixture.peers.length;
  fixture.button.click();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.deepEqual(fixture.timers.delays(), [500]);
    fixture.timers.runNext();
    const claimPeer = fixture.peers.at(-1);
    assert.equal(claimPeer.id, fixture.sync.MASTER_PEER_ID);
    claimPeer.emit('error', { type: 'unavailable-id' });
  }

  assert.equal(fixture.state.syncRole, 'viewer');
  assert.equal(fixture.timers.size, 0);
  const takeoverPeers = fixture.peers.slice(peersBeforeTakeover);
  assert.equal(takeoverPeers.filter((peer) => peer.id === fixture.sync.MASTER_PEER_ID).length, 3);
});

test('sender は DataConnection open 前に状態を送らず、open 後に初回状態を送る', async () => {
  const fixture = await createFixture();
  fixture.state.currentScreen = 'GAME';
  fixture.state.activeCategory = { id: 1 };
  fixture.state.solvedWords = new Set([0]);
  fixture.sync.initSync();
  const sender = fixture.peers.at(-1);
  sender.emit('open', fixture.sync.MASTER_PEER_ID);
  const connection = new fixture.FakeConnection(sender);

  sender.emit('connection', connection);
  assert.equal(connection.sent.length, 0);
  connection.open = true;
  connection.emit('open');

  assert.deepEqual(connection.sent, [{
    type: 'STATE_UPDATE',
    currentScreen: 'GAME',
    activeCategoryId: 1,
    solvedWords: [0]
  }]);
});

test('viewer は不正な STATE_UPDATE を無視し、有効な状態だけを反映する', async () => {
  const fixture = await createFixture();
  const { connection } = fixture.startAsViewer();
  const receivedPayloads = [];
  fixture.sync.registerSyncStateReceivedListener((payload) => receivedPayloads.push(payload));

  connection.emit('data', {
    type: 'STATE_UPDATE',
    currentScreen: 'GAME',
    activeCategoryId: 1,
    solvedWords: [0]
  });
  assert.equal(fixture.state.currentScreen, 'HOME');
  assert.equal(fixture.state.activeCategory.id, 1);
  assert.deepEqual([...fixture.state.solvedWords], [0]);
  assert.equal(receivedPayloads.length, 1);

  const invalidPayloads = [
    null,
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: null },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: 0 },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 999, solvedWords: [] },
    { type: 'STATE_UPDATE', currentScreen: 'INVALID', activeCategoryId: 1, solvedWords: [] },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: null, solvedWords: [] },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: new Set([0]) },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: [undefined] },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: [0.5] },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: [1] },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: [0, 0] },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: 1, solvedWords: new Set([0, 1]) },
    { type: 'STATE_UPDATE', currentScreen: 'GAME', activeCategoryId: null, solvedWords: [0] }
  ];
  for (const payload of invalidPayloads) connection.emit('data', payload);

  assert.equal(fixture.state.currentScreen, 'HOME');
  assert.equal(fixture.state.activeCategory.id, 1);
  assert.deepEqual([...fixture.state.solvedWords], [0]);
  assert.equal(receivedPayloads.length, 1);

  connection.emit('data', {
    type: 'STATE_UPDATE',
    currentScreen: 'GAME',
    activeCategoryId: 1,
    solvedWords: []
  });
  assert.deepEqual([...fixture.state.solvedWords], []);
  assert.equal(receivedPayloads.length, 2);
});

test('disconnected は current peer だけ reconnect する', async () => {
  const fixture = await createFixture();
  fixture.sync.initSync();
  const oldPeer = fixture.peers.at(-1);
  oldPeer.disconnected = true;
  oldPeer.emit('disconnected');
  assert.equal(oldPeer.reconnectCalls, 1);

  fixture.sync.initSync();
  const currentPeer = fixture.peers.at(-1);
  oldPeer.destroyed = false;
  oldPeer.emit('disconnected');
  currentPeer.disconnected = true;
  currentPeer.emit('disconnected');

  assert.equal(oldPeer.reconnectCalls, 1);
  assert.equal(currentPeer.reconnectCalls, 1);
});
