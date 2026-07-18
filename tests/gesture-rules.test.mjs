import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/gesture-rules.js', import.meta.url));
const sourceUrl = `data:text/javascript;base64,${source.toString('base64')}`;
const {
  detectFingerPoses,
  nextBackGestureState,
  detectFistByDistance,
  nextFistState
} = await import(sourceUrl);

const wrist = { x: 0, y: 0, z: 0 };
const fingerPairs = {
  thumb: [3, 4],
  index: [6, 8],
  middle: [10, 12],
  ring: [14, 16],
  pinky: [18, 20]
};

function makeLandmarks(extendedFingers = {}) {
  const landmarks = Array.from({ length: 21 }, () => ({ ...wrist }));
  landmarks[0] = wrist;

  for (const [finger, [jointIndex, tipIndex]] of Object.entries(fingerPairs)) {
    const isExtended = extendedFingers[finger] ?? false;
    landmarks[jointIndex] = { x: 0.5, y: 0, z: 0 };
    landmarks[tipIndex] = { x: isExtended ? 0.8 : 0.2, y: 0, z: 0 };
  }

  return landmarks;
}

test('detectFingerPoses は人差し指だけの伸展を決定ポーズとして判定する', () => {
  assert.deepEqual(
    detectFingerPoses(makeLandmarks({ index: true })),
    { isSelectPose: true, isBackPose: false }
  );
});

test('detectFingerPoses は親指と人差し指だけの伸展を戻るポーズとして判定する', () => {
  assert.deepEqual(
    detectFingerPoses(makeLandmarks({ thumb: true, index: true })),
    { isSelectPose: false, isBackPose: true }
  );
});

test('detectFingerPoses は余分な指が伸びているポーズを判定しない', () => {
  assert.deepEqual(
    detectFingerPoses(makeLandmarks({ index: true, middle: true })),
    { isSelectPose: false, isBackPose: false }
  );
  assert.deepEqual(
    detectFingerPoses(makeLandmarks({ thumb: true, index: true, pinky: true })),
    { isSelectPose: false, isBackPose: false }
  );
  assert.deepEqual(
    detectFingerPoses(makeLandmarks({ index: true, ring: true })),
    { isSelectPose: false, isBackPose: false }
  );
});

test('detectFingerPoses は全屈曲と同距離の境界を判定しない', () => {
  assert.deepEqual(
    detectFingerPoses(makeLandmarks()),
    { isSelectPose: false, isBackPose: false }
  );

  const boundary = makeLandmarks({ index: true });
  boundary[8] = { x: 0.5, y: 0, z: 0 };
  assert.deepEqual(
    detectFingerPoses(boundary),
    { isSelectPose: false, isBackPose: false }
  );
});

test('nextBackGestureState は戻るポーズの開始時だけトリガーする', () => {
  assert.deepEqual(nextBackGestureState(false, true), {
    isLatched: true,
    shouldTrigger: true
  });
  assert.deepEqual(nextBackGestureState(true, true), {
    isLatched: true,
    shouldTrigger: false
  });
});

test('nextBackGestureState は解除後の再成立で再度トリガーする', () => {
  const released = nextBackGestureState(true, false);
  assert.deepEqual(released, { isLatched: false, shouldTrigger: false });
  assert.deepEqual(nextBackGestureState(released.isLatched, true), {
    isLatched: true,
    shouldTrigger: true
  });
});

test('旧グー API は利用側の移行まで互換 export として維持する', () => {
  assert.equal(detectFistByDistance(makeLandmarks()), true);

  let hand = { isFistActive: false };
  hand = nextFistState(hand, true);
  hand = nextFistState(hand, true);
  hand = nextFistState(hand, true);

  assert.equal(hand.isFistActive, true);
});
