# 指先ジェスチャー入力 実装計画

> **エージェント作業者へ:** 必須サブスキル: `subagent-driven-development`（推奨）または `executing-plans` を用い、タスク単位で実装する。手順はチェックボックス（`- [ ]`）で追跡する。

**Goal:** 人差し指先端でカーソルを動かし、人差し指だけの間は検出フレームごとに決定し、親指と人差し指だけの戻るは1ポーズにつき1回だけ発火させる。

**Architecture:** 指構成の幾何判定と戻るラッチ遷移は `src/gesture-rules.js` の純粋関数へ集約する。`src/gestures.js` が各 MediaPipe 検出フレームでポーズと人差し指先端座標を更新し、戻るを優先してから `src/cursor.js` の選択処理を1回呼ぶ。描画用 `requestAnimationFrame` はカーソル補間とホバー表示だけを担い、入力頻度を増やさない。

**Tech Stack:** Vanilla JavaScript ES Modules、MediaPipe Hands、Node.js 標準 `node:test`、静的HTML/CSS。

---

## ファイル構成

- `src/gesture-rules.js`: 指ごとの伸展、決定／戻るポーズ、戻るラッチの純粋判定。
- `src/state.js`: 各手の現在ポーズとアプリ全体の戻るラッチ。
- `src/gestures.js`: 検出フレームの入力オーケストレーション、人差し指先端座標、MediaPipe停止時の状態初期化。
- `src/cursor.js`: ホバー対象の探索と、検出フレームから呼ばれる連続決定。
- `style.css`: 旧 `grabbing` 表現を新しい決定中の表現へ改名。
- `tests/gesture-rules.test.mjs`: 指構成とラッチの境界値。
- `tests/media-pipe-lifecycle.test.mjs`: カーソル、連続決定、単発戻る、役割ガード、旧操作無効化の統合確認。
- `README.md`, `CLAUDE.md`, `docs/20260719_gesture_brushup_audit.md`, `tasks/todo.md`, `index.html`: 利用者・開発者向け説明と進捗の正典化。

### Task 1: 指構成と戻るラッチを純粋関数で定義する

**Files:**
- Modify: `tests/gesture-rules.test.mjs`
- Modify: `src/gesture-rules.js`

- [x] **Step 1: 指構成の失敗テストを書く**

`tests/gesture-rules.test.mjs` の旧グー／3f・2fテストを、次のAPIを要求するテストへ置き換える。

```js
const {
  detectFingerPoses,
  nextBackGestureState
} = await import(sourceUrl);

const fingerJoints = {
  thumb: [4, 3],
  index: [8, 6],
  middle: [12, 10],
  ring: [16, 14],
  pinky: [20, 18]
};

function makeLandmarks(extendedNames = []) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [name, [tipIndex, jointIndex]] of Object.entries(fingerJoints)) {
    landmarks[jointIndex] = { x: 0.4, y: 0, z: 0 };
    landmarks[tipIndex] = { x: extendedNames.includes(name) ? 0.8 : 0.2, y: 0, z: 0 };
  }
  return landmarks;
}

test('人差し指だけを伸ばした手を決定ポーズとして排他的に判定する', () => {
  assert.deepEqual(detectFingerPoses(makeLandmarks(['index'])), {
    isSelectPose: true,
    isBackPose: false
  });
});

test('親指と人差し指だけを伸ばした手を戻るポーズとして排他的に判定する', () => {
  assert.deepEqual(detectFingerPoses(makeLandmarks(['thumb', 'index'])), {
    isSelectPose: false,
    isBackPose: true
  });
});

test('余分な指、全指屈曲、伸展境界はどちらの操作にも判定しない', () => {
  assert.deepEqual(detectFingerPoses(makeLandmarks(['index', 'middle'])), {
    isSelectPose: false,
    isBackPose: false
  });
  assert.deepEqual(detectFingerPoses(makeLandmarks()), {
    isSelectPose: false,
    isBackPose: false
  });
  const boundary = makeLandmarks(['index']);
  boundary[8] = { ...boundary[6] };
  assert.deepEqual(detectFingerPoses(boundary), {
    isSelectPose: false,
    isBackPose: false
  });
});
```

- [x] **Step 2: REDを確認する**

Run: `node --test tests/gesture-rules.test.mjs`

Expected: `detectFingerPoses` または `nextBackGestureState` が未定義でFAILする。

- [x] **Step 3: 最小の指構成判定を実装する**

`src/gesture-rules.js` は新APIを追加する。既存の `src/gestures.js` を壊さないため、旧 `detectFistByDistance` と `nextFistState` はTask 1のコミットでは一時互換として元の実装を維持し、利用側を移行するTask 2で削除する。

```js
const FINGER_JOINTS = {
  thumb: [4, 3],
  index: [8, 6],
  middle: [12, 10],
  ring: [16, 14],
  pinky: [20, 18]
};

function distance(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const dz = (first.z ?? 0) - (second.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

function isFingerExtended(landmarks, fingerName) {
  const [tipIndex, jointIndex] = FINGER_JOINTS[fingerName];
  const wrist = landmarks[0];
  return distance(landmarks[tipIndex], wrist) > distance(landmarks[jointIndex], wrist);
}

export function detectFingerPoses(landmarks) {
  const extended = Object.fromEntries(
    Object.keys(FINGER_JOINTS).map((name) => [name, isFingerExtended(landmarks, name)])
  );
  const otherFingersFolded = !extended.middle && !extended.ring && !extended.pinky;
  return {
    isSelectPose: !extended.thumb && extended.index && otherFingersFolded,
    isBackPose: extended.thumb && extended.index && otherFingersFolded
  };
}
```

- [x] **Step 4: 戻るラッチの失敗テストを書く**

```js
test('戻るは成立時に1回だけ発火し、解除後の再成立で再発火する', () => {
  let latch = false;

  let result = nextBackGestureState(latch, true);
  assert.deepEqual(result, { isLatched: true, shouldTrigger: true });
  latch = result.isLatched;

  result = nextBackGestureState(latch, true);
  assert.deepEqual(result, { isLatched: true, shouldTrigger: false });

  result = nextBackGestureState(result.isLatched, false);
  assert.deepEqual(result, { isLatched: false, shouldTrigger: false });

  result = nextBackGestureState(result.isLatched, true);
  assert.deepEqual(result, { isLatched: true, shouldTrigger: true });
});
```

- [x] **Step 5: REDを確認後、最小のラッチ遷移を実装する**

Run: `node --test tests/gesture-rules.test.mjs`

Expected: `nextBackGestureState` が未定義でFAILする。

```js
export function nextBackGestureState(isLatched, isBackPose) {
  return {
    isLatched: isBackPose,
    shouldTrigger: isBackPose && !isLatched
  };
}
```

- [x] **Step 6: GREENを確認する**

Run: `node --test tests/gesture-rules.test.mjs`

Expected: 指構成とラッチの全テストがPASSする。

- [ ] **Step 7: Task 1をコミットする**

Run: `git add src/gesture-rules.js tests/gesture-rules.test.mjs && git commit -m "feat: 指ポーズ判定を追加"`

Expected: 指構成と戻るラッチだけを含む1コミットが作成される。

### Task 2: 検出フレーム入力をカーソル・画面遷移へ統合する

**Files:**
- Modify: `src/gesture-rules.js`
- Modify: `tests/gesture-rules.test.mjs`
- Modify: `tests/media-pipe-lifecycle.test.mjs`
- Modify: `src/state.js`
- Modify: `src/gestures.js`
- Modify: `src/cursor.js`
- Modify: `style.css`

- [x] **Step 1: 統合テスト用の手ポーズとヒット対象を用意する**

`tests/media-pipe-lifecycle.test.mjs` のDOMスタブを、対象を差し替えられる形へ変更する。

```js
let hitTarget = null;
globalThis.document = {
  createElement: () => createElement(),
  getElementById: (id) => elements.get(id) ?? null,
  elementFromPoint: () => hitTarget
};

function createHandLandmarks(extendedNames = []) {
  const joints = {
    thumb: [4, 3],
    index: [8, 6],
    middle: [12, 10],
    ring: [16, 14],
    pinky: [20, 18]
  };
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0, y: 0, z: 0 };
  for (const [name, [tipIndex, jointIndex]] of Object.entries(joints)) {
    landmarks[jointIndex] = { x: 0.4, y: 0, z: 0 };
    landmarks[tipIndex] = { x: extendedNames.includes(name) ? 0.8 : 0.2, y: 0, z: 0 };
  }
  return landmarks;
}
```

`createElement()` には `id: ''` と、次の最小 `closest` 実装を加える。

```js
closest(selector) {
  const matches = selector.split(',').map((item) => item.trim()).some((item) => {
    if (item.startsWith('.')) return this.classList.contains(item.slice(1));
    if (item.startsWith('#')) return this.id === item.slice(1);
    return false;
  });
  return matches ? this : null;
}
```

各 `beforeEach` で `hitTarget = null`、`state.backGestureLatched = false`、`state.cameraOpacityIndex = 0`、各手の `isSelectPose/isBackPose = false` を復元する。

- [x] **Step 2: 人差し指先端と検出フレームごとの決定の失敗テストを書く**

```js
test('人差し指先端をカーソル目標にし、決定ポーズ中は検出フレームごとに対象を押す', () => {
  state.syncRole = 'sender';
  const cameraButton = elements.get('btn-camera-toggle');
  cameraButton.id = 'btn-camera-toggle';
  cameraButton.classList.add('btn-icon');
  hitTarget = cameraButton;

  const hand = createHandLandmarks(['index']);
  hand[8] = { x: 0.75, y: 0.2, z: 0 };
  onResults({ multiHandLandmarks: [hand] });
  onResults({ multiHandLandmarks: [hand] });

  assert.equal(state.hands[0].targetCursor.x, 0.25 * window.innerWidth);
  assert.equal(state.hands[0].targetCursor.y, 0.2 * window.innerHeight);
  assert.equal(state.cameraOpacityIndex, 2);
});
```

必要なら `toggleCameraView` のラベルDOMスタブを固定し、1検出フレームにつき `cameraOpacityIndex` が1だけ進むことを検証する。viewer/loadingでは同じ入力を与えても値が変わらないテストも追加する。

- [x] **Step 3: 戻る単発と旧合掌無効化の失敗テストを書く**

```js
test('戻るポーズはsenderのGAMEで1回だけ発火し、解除後に再武装する', () => {
  state.syncRole = 'sender';
  state.currentScreen = 'GAME';
  const backHand = createHandLandmarks(['thumb', 'index']);

  onResults({ multiHandLandmarks: [backHand] });
  assert.equal(state.currentScreen, 'HOME');
  assert.equal(state.backGestureLatched, true);

  state.currentScreen = 'GAME';
  onResults({ multiHandLandmarks: [backHand] });
  assert.equal(state.currentScreen, 'GAME');

  onResults({ multiHandLandmarks: [createHandLandmarks(['index'])] });
  assert.equal(state.backGestureLatched, false);
  onResults({ multiHandLandmarks: [backHand] });
  assert.equal(state.currentScreen, 'HOME');
});

test('旧グーと両手合掌は決定も戻るも発火しない', () => {
  state.syncRole = 'sender';
  state.currentScreen = 'GAME';
  onResults({ multiHandLandmarks: [createHandLandmarks(), createHandLandmarks()] });
  assert.equal(state.currentScreen, 'GAME');
});
```

viewer/loadingの戻る無効、MediaPipe停止後にポーズとグローバルラッチが初期化される既存テストも新状態名へ更新する。

- [x] **Step 4: REDを確認する**

Run: `node --test tests/media-pipe-lifecycle.test.mjs`

Expected: 変更前の旧実装は座標に landmark 9 を参照しているため、人差し指先端を正典とする新テストがFAILする。現行正典の入力ランドマークは landmark 8 であり、決定ポーズ／戻るラッチも未実装のため新テストがFAILする。

- [x] **Step 5: 状態を新しい入力語彙へ置換する**

`src/state.js` の各手から `isFistActive/isFistTriggered` を削除し、次を持たせる。`lastClapTime` は削除する。

```js
hands: [
  { cursor: { x: 0, y: 0 }, targetCursor: { x: 0, y: 0 }, isDetected: false, hoveredElement: null, isSelectPose: false, isBackPose: false },
  { cursor: { x: 0, y: 0 }, targetCursor: { x: 0, y: 0 }, isDetected: false, hoveredElement: null, isSelectPose: false, isBackPose: false }
],
isHandDetected: false,
backGestureLatched: false,
```

- [x] **Step 6: 決定処理を描画ループから検出フレームへ移す**

`src/cursor.js` のRAF内では補間、表示、ホバーだけを行い、旧トリガーフラグを削除する。次の関数をexportする。

```js
const INTERACTIVE_SELECTOR = '.category-card, .word-card, .btn-back, .btn, .btn-icon';

function getInteractiveElementAt(x, y) {
  return document.elementFromPoint(x, y)?.closest(INTERACTIVE_SELECTOR) ?? null;
}

export function processGestureSelection(handIdx) {
  if (state.syncRole !== 'sender') return;
  const hand = state.hands[handIdx];
  if (!hand.isDetected || !hand.isSelectPose) return;
  const interactiveElement = getInteractiveElementAt(hand.cursor.x, hand.cursor.y);
  if (interactiveElement) triggerSelectAction(interactiveElement);
}
```

`processHoverAndGrab` は同じ `getInteractiveElementAt` を使用し、ポーズ中の見た目だけ `selecting` クラスで示す。ここから `triggerSelectAction` を呼ばない。`clearHoverStates` と `resetHandState` も `grabbing` ではなく `selecting` を除去し、`style.css` の対応セレクタを同名へ変更する。

- [x] **Step 7: MediaPipe検出を新ルールへ接続する**

`src/gestures.js` は `playClapSound` と `transitionTo` を戻る効果に引き続き使用し、`detectFingerPoses`、`nextBackGestureState`、`processGestureSelection` をimportする。各検出手で次を行う。

```js
const pointerJoint = landmarks[8];
handState.targetCursor.x = (1 - pointerJoint.x) * window.innerWidth;
handState.targetCursor.y = pointerJoint.y * window.innerHeight;
Object.assign(handState, detectFingerPoses(landmarks));
```

全手を処理した後、`hasBackPose = state.hands.some((hand) => hand.isDetected && hand.isBackPose)` を、role/screenに関係なくラッチ関数へ渡す。`shouldTrigger` かつ sender/GAMEなら、選択より先に音と `transitionTo('HOME')` を1回実行してreturnする。HOME・viewer・loadingで成立したポーズもラッチされ、保持したままsender/GAMEへ変わっても後から発火しない。全手で戻るポーズが不成立になった時だけ再武装する。それ以外では sender の `isSelectPose` の手ごとに `processGestureSelection(index)` を1回呼ぶ。検出されない手は両ポーズをfalseへ戻し、MediaPipe停止時は `state.backGestureLatched = false` も初期化する。旧合掌距離、時刻クールダウン、グー3f/2f処理は削除する。

`drawHandSkeleton` の第3引数は `isFistActive` から `isActionPose` へ改名し、`handState.isSelectPose || handState.isBackPose` を渡す。アクション中の緑色フィードバックは維持するが、旧グー状態への依存は残さない。

`src/gestures.js` の旧API利用が0件になった同じ差分内で、Task 1に一時互換として残した `detectFistByDistance` と `nextFistState` を `src/gesture-rules.js` から削除する。

- [x] **Step 8: GREENと全回帰を確認する**

Run: `node --test tests/gesture-rules.test.mjs tests/media-pipe-lifecycle.test.mjs`

Expected: 新規・更新テストが全件PASSする。

Run: `node --test tests/*.test.mjs`

Expected: 全テストがPASSし、失敗・警告がない。

- [ ] **Step 9: Task 2をコミットする**

Run: `git add src/state.js src/gestures.js src/cursor.js style.css tests/media-pipe-lifecycle.test.mjs && git commit -m "feat: 指先カーソル入力を統合"`

Expected: 入力統合とその回帰テストだけを含む1コミットが作成される。

### Task 3: UI・文書・進捗を新仕様へ統一する

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/20260719_gesture_brushup_audit.md`
- Modify: `tasks/todo.md`
- Modify: `index.html`

- [x] **Step 1: 旧語彙の存在を確認する**

Run: `rg -n "グー|合掌|3フレーム|2フレーム|Closed_Fist|手のひらカーソル" README.md CLAUDE.md docs/20260719_gesture_brushup_audit.md tasks/todo.md index.html`

Expected: 旧操作仕様の箇所が検出される。完了済み過去レビューの事実記録と、新仕様へ更新すべき現在仕様を区別する。

- [x] **Step 2: 利用者向け操作表と開発者向け構成を更新する**

READMEの操作表は次の意味へ統一する。

```markdown
| カーソル移動 | 人差し指の先端 | 指先に追従 |
| 決定 | 人差し指だけを伸ばす | ボタン上で検出フレームごとに入力 |
| 戻る | 親指と人差し指だけを伸ばす | GAMEからHOMEへ1ポーズ1回 |
```

`CLAUDE.md` のモジュール説明と手動確認手順も同じ語彙へ変更する。`index.html` の「手のひらカーソル」コメントは「人差し指先端カーソル」へ更新する。画面表示要素やDOM構造は変更しない。

- [x] **Step 3: 監査文書と進捗表を正典化する**

`docs/20260719_gesture_brushup_audit.md` の目的、操作設計、ジェスチャー実施方針、受け入れ条件、残課題を新仕様へ変更する。旧ブラッシュアップで実際に実施した28テスト等の履歴は消さず、「後続の指先入力変更で置換」と明示する。

`tasks/todo.md` の「追補: 指先ジェスチャー入力」ゲートを実装・検証結果に合わせてチェックし、レビュー欄へテスト件数と監査結果を追記する。完了条件のないTODOは作らない。

監査文書と進捗表は、ADRの操作設計を次の内容で要約する。

```markdown
| 操作 | 入力 | 発火方式 |
|---|---|---|
| ポインティング | 人差し指の先端 | 手の検出中に追従 |
| 決定 | 人差し指だけを伸ばす | 検出フレームごとにカーソル下の対象を押す |
| 戻る | 親指と人差し指だけを伸ばす | 全 `onResults` でラッチを更新し、sender/GAMEの成立エッジだけが即時1回発火。全手で不成立後に再武装 |
```

旧実施結果には次の注記を追加する。

```markdown
> この節のグー3フレーム／解除2フレームと合掌戻るは当時の検証履歴であり、2026-07-19の指先ジェスチャー入力変更によって置き換えられた。
```

- [x] **Step 4: 文書の旧語彙と差分品質を確認する**

Run: `rg -n "即時グー|合掌戻る|3f/2f|3フレームのグー|2フレームの解除|手のひらカーソル" README.md CLAUDE.md docs/20260719_gesture_brushup_audit.md tasks/todo.md index.html`

Expected: 現行仕様としての旧語彙が0件。履歴として残す場合は後続変更で無効になったことが同じ段落に明記される。

Run: `git diff --check`

Expected: 出力なし、exit 0。

- [ ] **Step 5: Task 3をコミットする**

Run: `git add README.md CLAUDE.md index.html docs/20260719_gesture_brushup_audit.md docs/20260719_gesture_pointer_input_spec.md docs/20260719_gesture_pointer_implementation_plan.md docs/decisions/20260719_gesture_pointer_actions.md tasks/todo.md && git commit -m "docs: 指先入力仕様へ統一"`

Expected: 設計記録、実装計画、利用者・開発者向け文書、進捗表を含む1コミットが作成される。

### Task 4: 統合検証と独立レビュー

**Files:**
- Verify only: `src/*.js`, `tests/*.mjs`, `README.md`, `CLAUDE.md`, `docs/*.md`, `tasks/todo.md`, `index.html`, `style.css`

- [ ] **Step 1: 構文と全テストを新鮮な状態で実行する**

Run: `Get-ChildItem app.js, src/*.js, tests/*.mjs | ForEach-Object { node --check $_.FullName }`

Expected: 全ファイルexit 0。

Run: `node --test tests/*.test.mjs`

Expected: 全件PASS、fail 0。

- [ ] **Step 2: 削除対象と差分を監査する**

Run: `rg -n "detectFist|nextFistState|isFist|fistDetectedFrames|fistReleasedFrames|lastClapTime|grabbing" src tests style.css`

Expected: 製品コードとテストの旧状態・旧クラスが0件。

Run: `git diff --check`

Expected: 出力なし、exit 0。

- [ ] **Step 3: 仕様適合レビューを実施する**

`docs/20260719_gesture_pointer_input_spec.md` の受け入れ条件を1行ずつ、テストまたは差分へ対応付ける。欠落があれば同じ実装担当へ戻し、再レビューする。

- [ ] **Step 4: コード品質レビューと批判レビューを実施する**

仕様適合後に、正しさ、構造、命名、状態初期化、複数手、役割ガード、旧入力撤去を独立レビューする。Critical/Importantは実装担当へ戻し、修正後に同じ観点で再レビューする。

## 完了条件

- 指先入力仕様の全受け入れ条件を自動テストまたは差分監査で証明できる。
- 全Nodeテスト、全JavaScript構文検査、`git diff --check` が成功する。
- 仕様適合、コード品質、批判レビューに未解決のCritical/Importantがない。
- 実カメラでの操作感確認だけを、完了条件付きの残課題として記録する。
