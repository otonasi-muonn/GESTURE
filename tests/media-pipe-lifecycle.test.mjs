import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
  #classes = new Set();

  add(...classes) {
    classes.forEach((className) => this.#classes.add(className));
  }

  remove(...classes) {
    classes.forEach((className) => this.#classes.delete(className));
  }

  contains(className) {
    return this.#classes.has(className);
  }
}

function createElement() {
  return {
    classList: new FakeClassList(),
    style: {},
    textContent: '',
    srcObject: null,
    getContext: () => canvasContext,
    closest: () => indicator,
    addEventListener: () => {},
    querySelector: () => createElement()
  };
}

const indicator = createElement();
const canvasContext = {
  clearCalls: 0,
  clearRect() { this.clearCalls += 1; },
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  arc() {},
  fill() {}
};
const elements = new Map();
[
  'screen-home', 'screen-game', 'category-list', 'word-list', 'active-category-title',
  'camera-container', 'webcam', 'canvas-overlay', 'btn-sound-init', 'btn-camera-toggle',
  'btn-back-manual', 'btn-reset-round', 'hands-detected-text', 'hand-cursor-0', 'hand-cursor-1'
].forEach((id) => elements.set(id, createElement()));

globalThis.document = {
  createElement: () => createElement(),
  getElementById: (id) => elements.get(id) ?? null,
  elementFromPoint: () => null
};
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

const { state } = await import('../src/state.js');
const { initMediaPipe, onResults, stopMediaPipe } = await import('../src/gestures.js');
const { triggerSelectAction } = await import('../src/cursor.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let fakes;
let originalConsoleLog;
let originalConsoleError;

class FakeHands {
  constructor(options) {
    this.options = options;
    this.closeCalls = 0;
    fakes.hands.push(this);
  }

  setOptions() {
    if (fakes.setOptionsError) throw fakes.setOptionsError;
  }
  onResults() {}

  close() {
    this.closeCalls += 1;
    fakes.onHandsClose?.(this);
    return fakes.closePlans.shift() ?? Promise.resolve();
  }
}

class FakeCamera {
  constructor(video, options) {
    this.video = video;
    this.options = options;
    this.stopCalls = 0;
    const track = { stopCalls: 0, stop() { this.stopCalls += 1; } };
    this.stream = { getTracks: () => [track], track };
    fakes.streams.push(this.stream);
    fakes.cameras.push(this);
  }

  start() {
    const startPlan = fakes.startPlans.shift() ?? Promise.resolve();
    return Promise.resolve(startPlan).then(() => {
      this.video.srcObject = this.stream;
    });
  }

  stop() {
    this.stopCalls += 1;
    this.video.srcObject?.getTracks?.().forEach((track) => track.stop());
    this.video.srcObject = null;
    fakes.onCameraStop?.(this);
  }
}

globalThis.Hands = FakeHands;
globalThis.Camera = FakeCamera;

function resetState() {
  state.currentScreen = 'HOME';
  state.syncRole = 'loading';
  state.lastClapTime = 0;
  state.audioContext = null;
  state.isHandDetected = false;
  state.hands.forEach((hand) => Object.assign(hand, {
    cursor: { x: 0, y: 0 },
    targetCursor: { x: 0, y: 0 },
    isDetected: false,
    hoveredElement: null,
    fistDetectedFrames: 0,
    fistReleasedFrames: 0,
    isFistActive: false,
    isFistTriggered: false
  }));
}

function createClapResults() {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  return { multiHandLandmarks: [hand, hand] };
}

async function withoutCameraLogs(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    await callback();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function settlesWithinMicrotasks(promise, turns = 12) {
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; }
  );
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
  return settled;
}

beforeEach(() => {
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  console.log = () => {};
  console.error = () => {};
  fakes = {
    cameras: [],
    hands: [],
    streams: [],
    startPlans: [],
    closePlans: [],
    onCameraStop: null,
    onHandsClose: null,
    setOptionsError: null
  };
  canvasContext.clearCalls = 0;
  indicator.classList.remove('camera-unavailable');
  elements.get('hands-detected-text').textContent = '';
  resetState();
});

afterEach(async () => {
  await stopMediaPipe();
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test('init → stop → init は旧Hands.close完了後に新しいCameraを生成する', async () => {
  await withoutCameraLogs(async () => {
    const close = deferred();
    fakes.closePlans.push(close.promise);

    await initMediaPipe();
    const stopping = stopMediaPipe();
    const restarting = initMediaPipe();
    await Promise.resolve();

    assert.equal(fakes.cameras.length, 1);
    close.resolve();
    await stopping;
    await restarting;
    assert.equal(fakes.cameras.length, 2);
    assert.equal(fakes.hands[0].closeCalls, 1);
  });
});

test('開始保留中に停止すると、開始完了後にも旧Cameraを停止して資源をリセットする', async () => {
  const start = deferred();
  const track = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const hovered = createElement();
  fakes.startPlans.push(start.promise);
  elements.get('webcam').srcObject = { getTracks: () => [track] };
  state.hands[0].cursor = { x: 12, y: 34 };
  state.hands[0].targetCursor = { x: 56, y: 78 };
  state.hands[0].hoveredElement = hovered;
  state.hands[0].isFistActive = true;
  state.hands[0].isFistTriggered = true;
  elements.get('hand-cursor-0').classList.add('hovering', 'grabbing');
  hovered.classList.add('hovered');

  await initMediaPipe();
  const stopping = stopMediaPipe();
  await Promise.resolve();
  assert.equal(fakes.cameras[0].stopCalls, 1);

  start.resolve();
  await stopping;

  assert.equal(fakes.cameras[0].stopCalls, 2);
  assert.equal(fakes.hands[0].closeCalls, 1);
  assert.equal(track.stopCalls, 1);
  assert.equal(elements.get('webcam').srcObject, null);
  assert.equal(state.hands[0].cursor.x, 0);
  assert.equal(state.hands[0].targetCursor.y, 0);
  assert.equal(state.hands[0].isFistActive, false);
  assert.equal(hovered.classList.contains('hovered'), false);
  assert.equal(elements.get('hand-cursor-0').classList.contains('hidden'), true);
  assert.equal(canvasContext.clearCalls > 0, true);
});

test('永久に開始保留でも、停止の資源回収後に後続初期化が進む', async () => {
  const start = deferred();
  fakes.startPlans.push(start.promise);

  await initMediaPipe();
  const stopping = stopMediaPipe();
  const restarting = initMediaPipe();

  try {
    assert.equal(await settlesWithinMicrotasks(Promise.all([stopping, restarting])), true);
    assert.equal(fakes.cameras.length, 2);
    assert.equal(fakes.cameras[0].stopCalls, 1);
    assert.equal(fakes.hands[0].closeCalls, 1);
  } finally {
    start.resolve();
    await Promise.all([stopping, restarting]);
  }
});

test('旧startが遅延解決しても新世代のpreviewと資源を維持する', async () => {
  const oldStart = deferred();
  const staleCameraStopped = deferred();
  fakes.startPlans.push(oldStart.promise);

  await initMediaPipe();
  const stopping = stopMediaPipe();
  const restarting = initMediaPipe();
  assert.equal(await settlesWithinMicrotasks(Promise.all([stopping, restarting])), true);

  const oldCamera = fakes.cameras[0];
  const currentCamera = fakes.cameras[1];
  const oldStream = fakes.streams[0];
  const currentStream = fakes.streams[1];
  fakes.onCameraStop = (camera) => {
    if (camera === oldCamera && camera.stopCalls === 2) staleCameraStopped.resolve();
  };

  oldStart.resolve();
  assert.equal(await settlesWithinMicrotasks(staleCameraStopped.promise), true);

  assert.equal(elements.get('webcam').srcObject, currentStream);
  assert.equal(oldStream.track.stopCalls, 1);
  assert.equal(currentStream.track.stopCalls, 0);
  assert.equal(currentCamera.stopCalls, 0);
  assert.equal(fakes.hands[0].closeCalls, 1);
  assert.equal(fakes.hands[1].closeCalls, 0);
});

test('二重stopは同じ資源を一度だけ閉じる', async () => {
  await initMediaPipe();
  await Promise.resolve();
  await Promise.resolve();

  await Promise.all([stopMediaPipe(), stopMediaPipe()]);

  assert.equal(fakes.cameras[0].stopCalls, 1);
  assert.equal(fakes.hands[0].closeCalls, 1);
});

test('開始失敗は現在世代を回収して失敗表示を残し、後続の初期化成功で古い表示を漏らさない', async () => {
  await withoutCameraLogs(async () => {
    const handsClosed = deferred();
    const track = { stopCalls: 0, stop() { this.stopCalls += 1; } };
    fakes.startPlans.push(Promise.reject(new Error('denied')));
    fakes.onHandsClose = handsClosed.resolve;
    elements.get('webcam').srcObject = { getTracks: () => [track] };
    await initMediaPipe();
    assert.equal(await settlesWithinMicrotasks(handsClosed.promise), true);

    assert.equal(fakes.cameras[0].stopCalls, 1);
    assert.equal(fakes.hands[0].closeCalls, 1);
    assert.equal(track.stopCalls, 1);
    assert.equal(elements.get('webcam').srcObject, null);
    assert.equal(elements.get('hands-detected-text').textContent, 'カメラ利用不可（マウス／タッチ操作可）');
    assert.equal(indicator.classList.contains('camera-unavailable'), true);

    await initMediaPipe();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(indicator.classList.contains('camera-unavailable'), false);
  });
});

test('active登録前の同期失敗は部分生成Handsとtrackを回収し、後続initを許可する', async () => {
  const track = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  elements.get('webcam').srcObject = { getTracks: () => [track] };
  state.hands[0].cursor = { x: 12, y: 34 };
  state.hands[0].isFistActive = true;
  fakes.setOptionsError = new Error('invalid options');

  await initMediaPipe();

  assert.equal(fakes.hands[0].closeCalls, 1);
  assert.equal(fakes.cameras.length, 0);
  assert.equal(track.stopCalls, 1);
  assert.equal(elements.get('webcam').srcObject, null);
  assert.equal(state.hands[0].cursor.x, 0);
  assert.equal(state.hands[0].isFistActive, false);
  assert.equal(elements.get('hands-detected-text').textContent, 'カメラ利用不可（マウス／タッチ操作可）');
  assert.equal(indicator.classList.contains('camera-unavailable'), true);

  fakes.setOptionsError = null;
  await initMediaPipe();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fakes.hands.length, 2);
  assert.equal(fakes.cameras.length, 1);
  assert.equal(indicator.classList.contains('camera-unavailable'), false);
});

test('viewerとloadingの合掌は遷移せず、senderの合掌だけHOMEへ戻る', () => {
  state.currentScreen = 'GAME';
  state.syncRole = 'viewer';
  onResults(createClapResults());
  assert.equal(state.currentScreen, 'GAME');

  state.lastClapTime = 0;
  state.syncRole = 'loading';
  onResults(createClapResults());
  assert.equal(state.currentScreen, 'GAME');

  state.lastClapTime = 0;
  state.syncRole = 'sender';
  onResults(createClapResults());
  assert.equal(state.currentScreen, 'HOME');
});

test('viewerとloadingのカーソル戻る操作は音も画面遷移も発生させない', () => {
  const originalSetTimeout = globalThis.setTimeout;
  let scheduledTasks = 0;
  globalThis.setTimeout = () => {
    scheduledTasks += 1;
    return 0;
  };
  state.currentScreen = 'GAME';
  state.syncRole = 'viewer';
  state.audioContext = {};
  const backButton = createElement();
  backButton.id = 'btn-back-manual';

  try {
    triggerSelectAction(backButton);
    assert.equal(state.currentScreen, 'GAME');
    assert.equal(scheduledTasks, 0);

    state.syncRole = 'loading';
    triggerSelectAction(backButton);
    assert.equal(state.currentScreen, 'GAME');
    assert.equal(scheduledTasks, 0);
  } finally {
    state.audioContext = null;
    globalThis.setTimeout = originalSetTimeout;
  }
});
