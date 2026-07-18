import { state, elWebcam, elBtnCameraToggle } from './state.js';
import { initAudio, playHoverSound, playClapSound } from './audio.js';
import { selectCategory, toggleWordSolved, transitionTo, resetCurrentRound } from './ui.js';

// ポンダー位置のスムージング(Lerp)ループ
export function updateCursorSmoothLoop() {
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

function getInteractiveElementAt(x, y) {
  const target = document.elementFromPoint(x, y);
  const interactiveEl = target?.closest('.category-card, .word-card, .btn-back, .btn, .btn-icon');
  if (!interactiveEl) return null;

  const screen = interactiveEl.closest('.screen');
  if (!screen) return interactiveEl;

  const activeScreenId = `screen-${state.currentScreen.toLowerCase()}`;
  return screen.id === activeScreenId ? interactiveEl : null;
}

// ホバーと表示状態の更新
export function processHoverAndGrab(handIdx, elCursor) {
  const hand = state.hands[handIdx];
  const interactiveEl = getInteractiveElementAt(hand.cursor.x, hand.cursor.y);
  
  if (interactiveEl) {
    // 新しい要素にホバーした場合
    if (hand.hoveredElement !== interactiveEl) {
      clearHoverStates(handIdx, elCursor);
      hand.hoveredElement = interactiveEl;
      hand.hoveredElement.classList.add('hovered');
      playHoverSound();
      elCursor.classList.add('hovering');
    }
    elCursor.classList.toggle('selecting', hand.isSelectPose || hand.isBackPose);
  } else {
    // インタラクティブ要素から外れた場合
    clearHoverStates(handIdx, elCursor);
  }
}

export function processGestureSelection(handIdx) {
  const hand = state.hands[handIdx];
  if (state.syncRole === 'viewer' || !hand?.isDetected) return;

  const now = performance.now();
  
  if (hand.isSelectPose) {
    // ピンチ検出中はリリース用タイマーをリセット
    hand.pinchReleaseTime = null;
    
    const interactiveEl = getInteractiveElementAt(hand.cursor.x, hand.cursor.y);
    
    if (interactiveEl) {
      // 1. インタラクティブ要素の上での決定処理（1回のつまみで1クリックのみ。連打防止）
      if (!hand.isSelectTriggered && (now - hand.lastClickTime > 500)) {
        hand.isSelectTriggered = true;
        hand.lastClickTime = now;
        triggerSelectAction(interactiveEl);
      }
    } else {
      // 2. 何もない空の場所で決定（ピンチ）した場合はカテゴリー選択画面へ戻る
      if (!hand.isSelectTriggered && (now - hand.lastClickTime > 500)) {
        hand.isSelectTriggered = true;
        hand.lastClickTime = now;
        if (state.currentScreen === 'GAME') {
          playClapSound();
          transitionTo('HOME');
        }
      }
    }
  } else {
    // ピンチが解除された際、ノイズ（1フレームの誤検出）による連続クリックを防ぐため、
    // 250ms以上継続してピンチが解除された場合のみ次のクリックを可能にする（1つまみ1クリックの厳格化）
    if (!hand.pinchReleaseTime) {
      hand.pinchReleaseTime = now;
    }
    
    if (now - hand.pinchReleaseTime > 250) {
      hand.isSelectTriggered = false;
    }
  }
}

export function clearHoverStates(handIdx, elCursor) {
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
    elCursor.classList.remove('hovering', 'selecting');
  }
}

// ジェスチャーによって選択された要素のクリック疑似発火
export function triggerSelectAction(element) {
  if (element.classList.contains('category-card')) {
    const catId = element.dataset.id;
    selectCategory(catId);
  } else if (element.classList.contains('word-card')) {
    const wordIdx = element.dataset.index;
    toggleWordSolved(wordIdx);
  } else if (element.id === 'btn-back-manual' || element.classList.contains('btn-back')) {
    if (state.syncRole === 'viewer') return;
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
export const OPACITIES = [
  { value: 0.4, label: "背景カメラ: 中" },
  { value: 0.8, label: "背景カメラ: 明" },
  { value: 0.0, label: "背景カメラ: OFF" },
  { value: 0.1, label: "背景カメラ: 暗" }
];

export function toggleCameraView() {
  state.cameraOpacityIndex = (state.cameraOpacityIndex + 1) % OPACITIES.length;
  const targetOpacity = OPACITIES[state.cameraOpacityIndex];
  
  // ビデオの不透明度を設定
  elWebcam.style.opacity = targetOpacity.value;
  
  // ボタンテキストの変更
  elBtnCameraToggle.querySelector('.label').textContent = targetOpacity.label;
  
  playHoverSound();
}
