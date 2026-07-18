import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const syncRulesSource = await readFile(new URL('../src/sync-rules.js', import.meta.url), 'utf8');
const { canChangeLocalState, shouldAttemptTakeoverClaim } = await import(
  `data:text/javascript;base64,${Buffer.from(syncRulesSource).toString('base64')}`
);

test('sender だけがローカル状態を変更でき、loading と viewer は変更できない', () => {
  assert.equal(canChangeLocalState('viewer'), false);
  assert.equal(canChangeLocalState('loading'), false);
  assert.equal(canChangeLocalState('sender'), true);
});

test('takeover claim は attempt 1 から 3 までだけ許可し、4 回目で停止する', () => {
  assert.equal(shouldAttemptTakeoverClaim(1), true);
  assert.equal(shouldAttemptTakeoverClaim(2), true);
  assert.equal(shouldAttemptTakeoverClaim(3), true);
  assert.equal(shouldAttemptTakeoverClaim(4), false);
});
