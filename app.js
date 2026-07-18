/* ==========================================================================
   Gesture Show! - Core Game Logic & Gesture Engine
   ========================================================================== */

// お題リストのデータ構造（全60単語、6カテゴリー）
const CATEGORIES = [
  {
    id: 0,
    name: "動物",
    icon: "🐼",
    desc: "身近な生き物からユニークな動物まで",
    words: ["パンダ", "カンガルー", "フラミンゴ", "ナマケモノ", "ペンギン", "タコ", "カメ", "ゾウ", "コアラ", "ウサギ"]
  },
  {
    id: 1,
    name: "職業",
    icon: "👨‍🚒",
    desc: "街で働くかっこいいお仕事",
    words: ["消防士", "お医者さん", "パン屋さん", "美容師", "警察官", "先生", "料理人", "宇宙飛行士", "漁師", "大工さん"]
  },
  {
    id: 2,
    name: "スポーツ動作",
    icon: "🎾",
    desc: "体を動かすアクティブなアクション",
    words: ["テニス", "卓球", "ボウリング", "なわとび", "水泳", "バスケのシュート", "ゴルフ", "釣り", "スキー", "綱引き"]
  },
  {
    id: 3,
    name: "日常動作",
    icon: "🪥",
    desc: "普段何気なく行っているしぐさ",
    words: ["歯みがき", "傘をさす", "電話をかける", "お辞儀", "くしゃみ", "コーヒーを飲む", "寝る", "全力走", "掃除機をかける", "写真を撮る"]
  },
  {
    id: 4,
    name: "感情・状態",
    icon: "😲",
    desc: "心や体のコンディションを表現",
    words: ["びっくりする", "大喜び", "激怒", "眠い", "暑い", "寒い", "痛い", "恥ずかしい", "緊張している", "疲れた"]
  },
  {
    id: 5,
    name: "おもしろ系",
    icon: "🤖",
    desc: "なりきり要素の強いバラエティ系",
    words: ["ロボット", "幽霊", "忍者", "サンタクロース", "マジシャン", "ゾンビ", "王様", "天使", "筋肉自慢", "ヒーロー変身"]
  }
];

// アプリのグローバル状態
const state = {
  currentScreen: 'HOME', // 'HOME' | 'GAME'
  activeCategory: null,
  solvedWords: new Set(), // 正解状態（インデックス 0〜9）の保持
  
  // ポインター＆ジェスチャー制御
  cursor: { x: 0, y: 0 },
  targetCursor: { x: 0, y: 0 },
  isHandDetected: false,
  
  // ホバーおよびクリック（グー）進行度
  hoveredElement: null,
  fistProgress: 0, // 0.0 〜 1.0 (進行度割合)
  fistStartTime: null,
  isFistActive: false,
  
  // 両手合掌の制御
  lastClapTime: 0,
  
  // カメラ設定
  cameraOpacityIndex: 0, // opacities 配列のインデックス
  audioContext: null
};

// UIエレメントの取得
const elCursor = document.getElementById('hand-cursor');
const elScreenHome = document.getElementById('screen-home');
const elScreenGame = document.getElementById('screen-game');
const elCategoryList = document.getElementById('category-list');
const elWordList = document.getElementById('word-list');
const elActiveCategoryTitle = document.getElementById('active-category-title');
const elScoreCounter = document.getElementById('score-counter');
const elCameraContainer = document.getElementById('camera-container');
const elWebcam = document.getElementById('webcam');
const elCanvas = document.getElementById('canvas-overlay');
const ctx = elCanvas.getContext('2d');

const elBtnSoundInit = document.getElementById('btn-sound-init');
const elBtnCameraToggle = document.getElementById('btn-camera-toggle');
const elBtnBackManual = document.getElementById('btn-back-manual');
const elBtnResetRound = document.getElementById('btn-reset-round');
const elCameraBadge = document.getElementById('camera-badge');
const elStatusMessage = document.getElementById('status-message');
const elHandsDetectedText = document.getElementById('hands-detected-text');

// ==========================================================================
// Web Audio APIによる効果音エンジン
// ==========================================================================

function initAudio() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    elBtnSoundInit.classList.add('active-hover');
    elBtnSoundInit.querySelector('.label').textContent = 'サウンド有効';
    playSuccessSound(); // テスト音
  }
}

function playSound(freqs, type = 'sine', duration = 0.1, delay = 0, volume = 0.1) {
  if (!state.audioContext) return;
  
  setTimeout(() => {
    try {
      const osc = state.audioContext.createOscillator();
      const gainNode = state.audioContext.createGain();
      
      osc.type = type;
      osc.connect(gainNode);
      gainNode.connect(state.audioContext.destination);
      
      // 音量制御
      gainNode.gain.setValueAtTime(volume, state.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, state.audioContext.currentTime + duration);
      
      // 周波数設定 (スイープ対応)
      if (Array.isArray(freqs)) {
        osc.frequency.setValueAtTime(freqs[0], state.audioContext.currentTime);
        if (freqs[1]) {
          osc.frequency.exponentialRampToValueAtTime(freqs[1], state.audioContext.currentTime + duration);
        }
      } else {
        osc.frequency.setValueAtTime(freqs, state.audioContext.currentTime);
      }
      
      osc.start();
      osc.stop(state.audioContext.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }, delay);
}

// 効果音定義
const playHoverSound = () => playSound(800, 'sine', 0.05, 0, 0.05);
const playSuccessSound = () => {
  playSound(523.25, 'sine', 0.15, 0, 0.1); // C5
  playSound(659.25, 'sine', 0.15, 80, 0.1); // E5
  playSound(784.00, 'sine', 0.25, 160, 0.1); // G5
};
const playClapSound = () => playSound([600, 250], 'triangle', 0.25, 0, 0.15);
const playBuzzerSound = () => {
  playSound(130, 'sawtooth', 0.3, 0, 0.15);
  playSound(130, 'sawtooth', 0.3, 100, 0.15);
};

// ==========================================================================
// 画面表示・描画系
// ==========================================================================

// カテゴリー選択画面の生成
function renderCategories() {
  elCategoryList.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const card = document.createElement('div');
    card.className = `category-card cat-${cat.id} glow-hover`;
    card.dataset.id = cat.id;
    card.innerHTML = `
      <div class="card-glow"></div>
      <span class="cat-icon">${cat.icon}</span>
      <h3>${cat.name}</h3>
      <p>${cat.desc}</p>
    `;
    
    // タッチ・マウスクリック時のフォールバック
    card.addEventListener('click', () => {
      selectCategory(cat.id);
    });
    
    elCategoryList.appendChild(card);
  });
}

// お題一覧画面の生成
function renderWords() {
  if (!state.activeCategory) return;
  
  elWordList.innerHTML = '';
  elActiveCategoryTitle.textContent = `${state.activeCategory.icon} ${state.activeCategory.name}`;
  
  state.activeCategory.words.forEach((word, index) => {
    const card = document.createElement('div');
    card.className = 'word-card glow-hover';
    card.dataset.index = index;
    if (state.solvedWords.has(index)) {
      card.classList.add('correct');
    }
    
    card.innerHTML = `
      <span class="word-num">${index + 1}</span>
      <span class="word-text">${word}</span>
    `;
    
    // タッチ・マウスクリック時のフォールバック
    card.addEventListener('click', () => {
      toggleWordSolved(index);
    });
    
    elWordList.appendChild(card);
  });
  
  updateScoreUI();
}

function updateScoreUI() {
  elScoreCounter.textContent = `${state.solvedWords.size} / 10`;
}

// 画面遷移処理
function transitionTo(screenName) {
  state.currentScreen = screenName;
  state.hands.forEach(h => {
    h.fistProgress = 0;
    h.fistStartTime = null;
  });
  
  if (screenName === 'HOME') {
    elScreenGame.classList.remove('active');
    setTimeout(() => {
      elScreenGame.style.display = 'none';
      elScreenHome.style.display = 'flex';
      setTimeout(() => elScreenHome.classList.add('active'), 20);
    }, 300);
  } else {
    elScreenHome.classList.remove('active');
    setTimeout(() => {
      elScreenHome.style.display = 'none';
      elScreenGame.style.display = 'flex';
      renderWords();
      setTimeout(() => elScreenGame.classList.add('active'), 20);
    }, 300);
  }
}

// カテゴリー選択実行
function selectCategory(id) {
  state.activeCategory = CATEGORIES.find(c => c.id === Number(id));
  state.solvedWords.clear();
  playSuccessSound();
  transitionTo('GAME');
}

// お題正解トグル
function toggleWordSolved(index) {
  index = Number(index);
  if (state.solvedWords.has(index)) {
    state.solvedWords.delete(index);
    playBuzzerSound();
  } else {
    state.solvedWords.add(index);
    playSuccessSound();
  }
  renderWords();
}

// リセット処理
function resetCurrentRound() {
  state.solvedWords.clear();
  playBuzzerSound();
  renderWords();
}

// ==========================================================================
// 手のポインター・ジェスチャー追跡ロジック
// ==========================================================================

// ポインター位置の物理スクリーンスムージング(Lerp)ループ
function updateCursorSmoothLoop() {
  const lerpFactor = 0.25;
  
  for (let i = 0; i < 2; i++) {
    const hand = state.hands[i];
    const elCursor = document.getElementById(`hand-cursor-${i}`);
    
    if (!elCursor) continue;
    
    // スムージング
    hand.cursor.x += (hand.targetCursor.x - hand.cursor.x) * lerpFactor;
    hand.cursor.y += (hand.targetCursor.y - hand.cursor.y) * lerpFactor;
    
    // カーソル要素の位置更新
    elCursor.style.left = `${hand.cursor.x}px`;
    elCursor.style.top = `${hand.cursor.y}px`;
    
    // 手が検出されている時のみカーソルを表示
    if (hand.isDetected) {
      elCursor.classList.remove('hidden');
      processHoverAndGrab(i, elCursor);
    } else {
      elCursor.classList.add('hidden');
      clearHoverStates(i, elCursor);
    }
  }
  
  requestAnimationFrame(updateCursorSmoothLoop);
}

// ホバー要素とグー選択判定のメイン処理
function processHoverAndGrab(handIdx, elCursor) {
  const hand = state.hands[handIdx];
  const target = document.elementFromPoint(hand.cursor.x, hand.cursor.y);
  let interactiveEl = null;
  
  if (target) {
    interactiveEl = target.closest('.category-card, .word-card, .btn-back, .btn, .btn-icon');
  }
  
  if (interactiveEl) {
    // 新しい要素にホバーした場合
    if (hand.hoveredElement !== interactiveEl) {
      clearHoverStates(handIdx, elCursor);
      hand.hoveredElement = interactiveEl;
      hand.hoveredElement.classList.add('hovered');
      playHoverSound();
      hand.fistProgress = 0;
      hand.fistStartTime = null;
      elCursor.classList.add('hovering');
    }
    
    // ホバー中に「グー」である場合の処理
    if (hand.isFistActive) {
      elCursor.classList.add('grabbing');
      elCursor.classList.add('loading');
      
      if (hand.fistStartTime === null) {
        hand.fistStartTime = performance.now();
      }
      
      // 0.5秒のホールドで確定
      const elapsed = (performance.now() - hand.fistStartTime) / 1000;
      hand.fistProgress = Math.min(1.0, elapsed / 0.5);
      
      // カーソルサイズを収縮させ、CSS変数に反映して視覚化
      const progressPercent = Math.min(100, hand.fistProgress * 100);
      elCursor.style.setProperty('--grab-progress', `${progressPercent}%`);
      
      // 確定トリガー
      if (hand.fistProgress >= 1.0) {
        triggerSelectAction(hand.hoveredElement);
        hand.fistProgress = 0;
        hand.fistStartTime = null;
        elCursor.classList.remove('loading');
      }
    } else {
      // グーを解いた場合
      elCursor.classList.remove('grabbing', 'loading');
      hand.fistProgress = 0;
      hand.fistStartTime = null;
    }
  } else {
    // インタラクティブ要素から外れた場合
    clearHoverStates(handIdx, elCursor);
  }
}

function clearHoverStates(handIdx, elCursor) {
  const hand = state.hands[handIdx];
  if (hand.hoveredElement) {
    // 他の手が同じ要素をホバーしていない場合のみ、ホバー表示クラスを消す
    const otherHandIdx = handIdx === 0 ? 1 : 0;
    const otherHand = state.hands[otherHandIdx];
    if (otherHand.hoveredElement !== hand.hoveredElement) {
      hand.hoveredElement.classList.remove('hovered');
    }
    hand.hoveredElement = null;
  }
  if (elCursor) {
    elCursor.classList.remove('hovering', 'grabbing', 'loading');
  }
  hand.fistProgress = 0;
  hand.fistStartTime = null;
}

// ジェスチャーによって選択された要素のクリック疑似発火
function triggerSelectAction(element) {
  if (element.classList.contains('category-card')) {
    const catId = element.dataset.id;
    selectCategory(catId);
  } else if (element.classList.contains('word-card')) {
    const wordIdx = element.dataset.index;
    toggleWordSolved(wordIdx);
  } else if (element.id === 'btn-back-manual' || element.classList.contains('btn-back')) {
    playClapSound();
    transitionTo('HOME');
  } else if (element.id === 'btn-reset-round') {
    resetCurrentRound();
  } else if (element.id === 'btn-sound-init') {
    initAudio();
  } else if (element.id === 'btn-camera-toggle') {
    toggleCameraView();
  }
}

// カメラ背景透過度の切り替えサイクル
const OPACITIES = [
  { value: 0.4, label: "背景カメラ: 中" },
  { value: 0.8, label: "背景カメラ: 明" },
  { value: 0.0, label: "背景カメラ: OFF" },
  { value: 0.1, label: "背景カメラ: 暗" }
];

function toggleCameraView() {
  state.cameraOpacityIndex = (state.cameraOpacityIndex + 1) % OPACITIES.length;
  const targetOpacity = OPACITIES[state.cameraOpacityIndex];
  
  // ビデオの不透明度を設定
  elWebcam.style.opacity = targetOpacity.value;
  
  // ボタンテキストの変更
  elBtnCameraToggle.querySelector('.label').textContent = targetOpacity.label;
  
  playHoverSound();
}

// ==========================================================================
// MediaPipe Hands コールバック & ジェスチャー分類
// ==========================================================================

// 指の起立状態チェック
// y座標は上方向が0、下方向が1。 tip.y < pip.y であれば、指先が関節より「上」にある ＝ 伸びている
function isFingerExtended(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y < landmarks[pipIdx].y;
}

// 親指の起立状態チェック
// 親指は横に開くため、手の向き（利き手、掌/甲）により左右判定が複雑になりますが、
// 簡易的には「指先（4）と第2関節（3）の水平距離が十分離れているか」等で検出します。
function isThumbExtended(landmarks, handLabel) {
  const tip = landmarks[4];
  const ip = landmarks[3];
  const mcp = landmarks[2];
  
  // 掌をカメラに向けた鏡像状態
  // 右手（物理）はカメラ映像上で左側に親指が出ます。左手は右側。
  // 水平方向(x)の距離を判定基準にします。
  const distHorizontal = Math.abs(tip.x - mcp.x);
  return distHorizontal > 0.05; // 閾値
}

function detectFist(landmarks, handLabel) {
  // 4本指（人差し指、中指、薬指、小指）の折りたたみ状態を確認
  // 折れ曲がっている ＝ tip.y > pip.y (画面の下方向にある)
  const indexFolded = landmarks[8].y > landmarks[6].y;
  const middleFolded = landmarks[12].y > landmarks[10].y;
  const ringFolded = landmarks[16].y > landmarks[14].y;
  const pinkyFolded = landmarks[20].y > landmarks[18].y;
  
  // 4本すべて畳まれていたら「グー」とする（親指は除外して安定化）
  return indexFolded && middleFolded && ringFolded && pinkyFolded;
}

// MediaPipe 検出処理
function onResults(results) {
  // キャンバスのクリアと描画準備
  ctx.clearRect(0, 0, elCanvas.width, elCanvas.height);
  
  // 検出された手の数
  const numHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
  
  // 両手とも一旦非検出にしてから再設定
  state.hands[0].isDetected = false;
  state.hands[1].isDetected = false;
  
  if (numHands > 0) {
    state.isHandDetected = true;
    elHandsDetectedText.textContent = `手検出中: ${numHands}個`;
    
    // 両手合わせ（クラップ・合掌）による「戻る」検出
    // 画面B（ゲーム中）で、2つの手が非常に近い距離にある場合
    if (state.currentScreen === 'GAME' && numHands >= 2) {
      const hand0_center = results.multiHandLandmarks[0][9]; // 中指の付け根
      const hand1_center = results.multiHandLandmarks[1][9];
      
      const dx = hand0_center.x - hand1_center.x;
      const dy = hand0_center.y - hand1_center.y;
      const dz = hand0_center.z - hand1_center.z;
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      const now = Date.now();
      // 閾値 0.08 (画像の対角サイズに対して約8%) かつ クールダウン 1.5秒
      if (distance < 0.08 && (now - state.lastClapTime > 1500)) {
        state.lastClapTime = now;
        playClapSound();
        transitionTo('HOME');
        return; // 即リターンして以降のポインター処理をスキップ
      }
    }
    
    // 検出された全ての手（最大2つ）を処理
    for (let i = 0; i < Math.min(2, numHands); i++) {
      const landmarks = results.multiHandLandmarks[i];
      const handMeta = results.multiHandedness[i];
      const handLabel = handMeta.label; // "Left" or "Right"
      
      const handState = state.hands[i];
      handState.isDetected = true;
      
      // ポインター位置の決定: 中指の付け根(Landmark 9)が物理的に安定していて良い
      const pointerJoint = landmarks[9];
      
      // 鏡像カメラなので、横座標(x)を反転させて画面幅にマッピング
      // x: 0.0 (左端) 〜 1.0 (右端)
      handState.targetCursor.x = (1 - pointerJoint.x) * window.innerWidth;
      handState.targetCursor.y = pointerJoint.y * window.innerHeight;
      
      // 「グー」のジェスチャー判定
      handState.isFistActive = detectFist(landmarks, handLabel);
      
      // キャンバスに骨格を描画
      drawHandSkeleton(landmarks, i, handState.isFistActive);
    }
  } else {
    state.isHandDetected = false;
    elHandsDetectedText.textContent = '手が見つかりません';
  }
}

// ネオン骨格の描画
function drawHandSkeleton(landmarks, handIdx, isFistActive) {
  // 接続関節リスト
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4], // 親指
    [0, 5], [5, 6], [6, 7], [7, 8], // 人差し指
    [5, 9], [9, 10], [10, 11], [11, 12], // 中指
    [9, 13], [13, 14], [14, 15], [15, 16], // 薬指
    [13, 17], [17, 18], [18, 19], [19, 20], // 小指
    [0, 17] // 手のひら底部
  ];
  
  const w = elCanvas.width;
  const h = elCanvas.height;
  
  // 関節をつなぐ線を描画
  let strokeColor = '#00f2fe'; // 1本目の手: シアン
  if (handIdx === 1) {
    strokeColor = '#fe019a'; // 2本目の手: マゼンタ
  }
  if (isFistActive) {
    strokeColor = '#39ff14'; // グーなら蛍光緑
  }
  
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 10;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  connections.forEach(([start, end]) => {
    ctx.beginPath();
    ctx.moveTo(landmarks[start].x * w, landmarks[start].y * h);
    ctx.lineTo(landmarks[end].x * w, landmarks[end].y * h);
    ctx.stroke();
  });
  
  // 各関節の丸い点を描画
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < landmarks.length; i++) {
    ctx.beginPath();
    ctx.arc(landmarks[i].x * w, landmarks[i].y * h, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// ==========================================================================
// アプリケーション起動・初期化
// ==========================================================================

function initApp() {
  renderCategories();
  
  // イベントリスナー登録
  elBtnSoundInit.addEventListener('click', initAudio);
  elBtnCameraToggle.addEventListener('click', toggleCameraView);
  elBtnBackManual.addEventListener('click', () => {
    playClapSound();
    transitionTo('HOME');
  });
  elBtnResetRound.addEventListener('click', resetCurrentRound);
  
  // キャンバスのサイズフィッティング
  function resizeCanvas() {
    elCanvas.width = elCameraContainer.clientWidth;
    elCanvas.height = elCameraContainer.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  
  // スムースカーソルループ開始
  updateCursorSmoothLoop();
  
  // MediaPipe Hands & カメラの初期化
  initMediaPipe();
}

function initMediaPipe() {
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  
  hands.setOptions({
    maxNumHands: 2, // 両手合わせ戻るジェスチャーのため2本
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });
  
  hands.onResults(onResults);
  
  const camera = new Camera(elWebcam, {
    onFrame: async () => {
      await hands.send({ image: elWebcam });
    },
    width: 640,
    height: 480
  });
  
  camera.start()
    .then(() => {
      elCameraBadge.className = 'badge badge-on';
      elCameraBadge.textContent = 'カメラON';
      elStatusMessage.textContent = 'カメラと手形追跡システムが起動しました。手をカメラにかざしてください。';
    })
    .catch((err) => {
      console.error('Camera startup failed', err);
      elCameraBadge.className = 'badge badge-off';
      elCameraBadge.textContent = 'カメラエラー';
      elStatusMessage.textContent = 'カメラの起動に失敗しました。カメラへの権限設定と接続を確認してください。マウスまたはタッチでも操作可能です。';
    });
}

// DOM読み込み完了時に起動
document.addEventListener('DOMContentLoaded', initApp);
