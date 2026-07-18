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
let hitTarget = null;
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
  elementFromPoint: () => hitTarget
};
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

const { state } = await import('../src/state.js');
const { initMediaPipe, onResults, stopMediaPipe } = await import('../src/gestures.js');
const { processGestureSelection, triggerSelectAction } = await import('../src/cursor.js');

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
  state.activeCategory = null;
  state.solvedWords.clear();
  state.syncRole = 'loading';
  state.backGestureLatched = false;
  state.cameraOpacityIndex = 0;
  state.audioContext = null;
  state.isHandDetected = false;
  state.hands.forEach((hand) => Object.assign(hand, {
    cursor: { x: 0, y: 0 },
    targetCursor: { x: 0, y: 0 },
    isDetected: false,
    hoveredElement: null,
    isSelectPose: false,
    isBackPose: false
  }));
}

const fingerPairs = {
  thumb: [3, 4],
  index: [6, 8],
  middle: [10, 12],
  ring: [14, 16],
  pinky: [18, 20]
};

function createPoseLandmarks(extendedFingers = {}, pointer = { x: 0.5, y: 0.5 }) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.2, y: 0, z: 0 }));
  landmarks[0] = { x: 0, y: 0, z: 0 };
  for (const [finger, [jointIndex, tipIndex]] of Object.entries(fingerPairs)) {
    landmarks[jointIndex] = { x: 0.5, y: 0, z: 0 };
    landmarks[tipIndex] = { x: extendedFingers[finger] ? 0.8 : 0.2, y: 0, z: 0 };
  }
  landmarks[8] = { x: pointer.x, y: pointer.y, z: 0 };
  return landmarks;
}

function createResults(...hands) {
  return { multiHandLandmarks: hands };
}

function createInteractiveTarget(id) {
  const target = createElement();
  target.id = id;
  target.classList.add('btn-icon');
  target.closest = (selector) => (selector === '.screen' ? null : target);
  return target;
}

function createScreenBoundWordTarget(screenId) {
  const screen = createElement();
  screen.id = screenId;
  screen.classList.add('screen');

  const target = createElement();
  target.dataset = { index: '0' };
  target.classList.add('word-card');
  target.closest = (selector) => {
    if (selector === '.screen') return screen;
    return target;
  };
  return target;
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
  hitTarget = null;
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
  state.hands[0].isSelectPose = true;
  state.hands[0].isBackPose = true;
  state.backGestureLatched = true;
  elements.get('hand-cursor-0').classList.add('hovering', 'selecting');
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
  assert.equal(state.hands[0].isSelectPose, false);
  assert.equal(state.hands[0].isBackPose, false);
  assert.equal(state.backGestureLatched, false);
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
  state.hands[0].isSelectPose = true;
  fakes.setOptionsError = new Error('invalid options');

  await initMediaPipe();

  assert.equal(fakes.hands[0].closeCalls, 1);
  assert.equal(fakes.cameras.length, 0);
  assert.equal(track.stopCalls, 1);
  assert.equal(elements.get('webcam').srcObject, null);
  assert.equal(state.hands[0].cursor.x, 0);
  assert.equal(state.hands[0].isSelectPose, false);
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

test('人差し指先端 landmarks[8] を左右反転してカーソル目標へ反映する', () => {
  onResults(createResults(createPoseLandmarks({}, { x: 0.25, y: 0.75 })));

  assert.equal(state.hands[0].targetCursor.x, 960);
  assert.equal(state.hands[0].targetCursor.y, 540);
});

test('sender の決定ポーズは同一 onResults の各手から一度ずつ選択する', () => {
  hitTarget = createInteractiveTarget('btn-camera-toggle');
  state.syncRole = 'sender';

  onResults(createResults(
    createPoseLandmarks({ index: true }),
    createPoseLandmarks({ index: true })
  ));

  assert.equal(state.cameraOpacityIndex, 2);
});

test('sender の同一手の決定ポーズは連続する検出フレームごとに選択する', () => {
  hitTarget = createInteractiveTarget('btn-camera-toggle');
  state.syncRole = 'sender';
  const selectPose = createPoseLandmarks({ index: true });

  onResults(createResults(selectPose));
  onResults(createResults(selectPose));

  assert.equal(state.cameraOpacityIndex, 2);
});

test('遷移直後の HOME では旧 screen-game 配下の word-card を選択しない', () => {
  hitTarget = createScreenBoundWordTarget('screen-game');
  state.currentScreen = 'HOME';
  state.syncRole = 'sender';

  onResults(createResults(createPoseLandmarks({ index: true })));

  assert.equal(state.solvedWords.size, 0);
});

test('processGestureSelection は sender の検出済み決定ポーズ以外では選択しない', () => {
  hitTarget = createInteractiveTarget('btn-camera-toggle');
  const hand = state.hands[0];

  state.syncRole = 'sender';
  hand.isDetected = true;
  hand.isSelectPose = true;
  processGestureSelection(0);
  assert.equal(state.cameraOpacityIndex, 1);
  state.cameraOpacityIndex = 0;

  for (const invalidState of [
    { syncRole: 'viewer', isDetected: true, isSelectPose: true },
    { syncRole: 'loading', isDetected: true, isSelectPose: true },
    { syncRole: 'sender', isDetected: false, isSelectPose: true },
    { syncRole: 'sender', isDetected: true, isSelectPose: false }
  ]) {
    state.syncRole = invalidState.syncRole;
    hand.isDetected = invalidState.isDetected;
    hand.isSelectPose = invalidState.isSelectPose;
    processGestureSelection(0);
    assert.equal(state.cameraOpacityIndex, 0);
  }
});

test('viewer と loading の決定ポーズは選択を発火しない', () => {
  hitTarget = createInteractiveTarget('btn-camera-toggle');

  for (const role of ['viewer', 'loading']) {
    state.syncRole = role;
    onResults(createResults(createPoseLandmarks({ index: true })));
  }

  assert.equal(state.cameraOpacityIndex, 0);
});

test('戻るポーズは成立エッジで一度だけ発火し、全手の解除後に再武装する', () => {
  state.currentScreen = 'GAME';
  state.syncRole = 'sender';
  const backPose = createPoseLandmarks({ thumb: true, index: true });

  onResults(createResults(backPose));
  assert.equal(state.currentScreen, 'HOME');
  assert.equal(state.backGestureLatched, true);

  state.currentScreen = 'GAME';
  onResults(createResults(backPose));
  assert.equal(state.currentScreen, 'GAME');

  onResults(createResults());
  assert.equal(state.backGestureLatched, false);

  onResults(createResults(backPose));
  assert.equal(state.currentScreen, 'HOME');
});

test('戻るポーズの手が検出 index 間で入れ替わっても継続中は再発火しない', () => {
  state.currentScreen = 'GAME';
  state.syncRole = 'sender';
  const backPose = createPoseLandmarks({ thumb: true, index: true });
  const inactivePose = createPoseLandmarks({}, { x: 0.2, y: 0 });

  onResults(createResults(backPose, inactivePose));
  assert.equal(state.currentScreen, 'HOME');

  state.currentScreen = 'GAME';
  onResults(createResults(inactivePose, backPose));
  assert.equal(state.currentScreen, 'GAME');
});

test('戻るポーズは同フレームの決定より優先し、viewer と loading では遷移しない', () => {
  hitTarget = createInteractiveTarget('btn-camera-toggle');
  const backPose = createPoseLandmarks({ thumb: true, index: true });
  const selectPose = createPoseLandmarks({ index: true });

  state.currentScreen = 'GAME';
  state.syncRole = 'sender';
  onResults(createResults(backPose, selectPose));
  assert.equal(state.currentScreen, 'HOME');
  assert.equal(state.cameraOpacityIndex, 0);

  for (const role of ['viewer', 'loading']) {
    onResults(createResults());
    state.currentScreen = 'GAME';
    state.syncRole = role;
    onResults(createResults(backPose));
    assert.equal(state.currentScreen, 'GAME');
  }
});

test('旧グーと両手合掌距離では選択も戻るも発火しない', () => {
  hitTarget = createInteractiveTarget('btn-camera-toggle');
  state.currentScreen = 'GAME';
  state.syncRole = 'sender';
  const fist = createPoseLandmarks({}, { x: 0.2, y: 0 });

  onResults(createResults(fist, fist));

  assert.equal(state.currentScreen, 'GAME');
  assert.equal(state.cameraOpacityIndex, 0);
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
