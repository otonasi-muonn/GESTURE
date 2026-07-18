import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/gesture-rules.js', import.meta.url));
const sourceUrl = `data:text/javascript;base64,${source.toString('base64')}`;
const { detectFistByDistance, nextFistState } = await import(sourceUrl);

const wrist = { x: 0, y: 0, z: 0 };
const fingerPairs = [
  [6, 8],
  [10, 12],
  [14, 16],
  [18, 20]
];

function makeLandmarks({ pipDistance, tipDistance }) {
  const landmarks = Array.from({ length: 21 }, () => ({ ...wrist }));
  landmarks[0] = wrist;
  fingerPairs.forEach(([pipIndex, tipIndex]) => {
    landmarks[pipIndex] = { x: pipDistance, y: 0, z: 0 };
    landmarks[tipIndex] = { x: tipDistance, y: 0, z: 0 };
  });
  return landmarks;
}

test('detectFistByDistance は手の向きに関係なく、指先がPIPより手首に近いグーを判定する', () => {
  const uprightFist = makeLandmarks({ pipDistance: 0.7, tipDistance: 0.3 });
  const invertedFist = makeLandmarks({ pipDistance: -0.7, tipDistance: -0.3 });

  assert.equal(detectFistByDistance(uprightFist), true);
  assert.equal(detectFistByDistance(invertedFist), true);
});

test('detectFistByDistance は開いた手と同距離の境界をグーにしない', () => {
  const openHand = makeLandmarks({ pipDistance: 0.3, tipDistance: 0.7 });
  const boundary = makeLandmarks({ pipDistance: 0.5, tipDistance: 0.5 });

  assert.equal(detectFistByDistance(openHand), false);
  assert.equal(detectFistByDistance(boundary), false);
});

test('nextFistState は連続3フレームでグーを確定する', () => {
  let hand = { isFistActive: false, fistDetectedFrames: 0, fistReleasedFrames: 0 };

  hand = nextFistState(hand, true);
  assert.equal(hand.isFistActive, false);
  hand = nextFistState(hand, true);
  assert.equal(hand.isFistActive, false);
  hand = nextFistState(hand, true);
  assert.equal(hand.isFistActive, true);
});

test('nextFistState は既存の手状態にカウンターがなくても3フレームで確定する', () => {
  let hand = { isFistActive: false };

  hand = nextFistState(hand, true);
  hand = nextFistState(hand, true);
  hand = nextFistState(hand, true);

  assert.equal(hand.isFistActive, true);
});

test('nextFistState は連続2フレームでグーを解除し、途中の検出では維持する', () => {
  let hand = { isFistActive: true, fistDetectedFrames: 3, fistReleasedFrames: 0 };

  hand = nextFistState(hand, false);
  assert.equal(hand.isFistActive, true);
  hand = nextFistState(hand, true);
  assert.equal(hand.isFistActive, true);
  hand = nextFistState(hand, false);
  assert.equal(hand.isFistActive, true);
  hand = nextFistState(hand, false);
  assert.equal(hand.isFistActive, false);
});
