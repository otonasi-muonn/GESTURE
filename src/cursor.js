import { state, elWebcam, elBtnCameraToggle } from './state.js';
import { playHoverSound, playClapSound } from './audio.js';
import { selectCategory, toggleWordSolved, transitionTo, resetCurrentRound } from './ui.js';
import { initAudio } from './audio.js';

// ポンダー位置のスムージング(Lerp)ループ
export function updateCursorSmoothLoop() {
  const lerpFactor = 0.25;
  
  for (let i = 0; i < 2; i++) {
    const hand = state.hands[i];
    const elCursor = document.getElementById(`hand-cursor-${i}`);
    
    if (!elCursor) continue;
    
    // グーが解除されたら、トリガー済フラグをリセット（チャタリング・連打防止）
    if (!hand.isFistActive) {
      hand.isFistTriggered = false;
    }
    
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
export function processHoverAndGrab(handIdx, elCursor) {
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
      hand.isFistTriggered = false;
      elCursor.classList.add('hovering');
    }
    
    // ホバー中に「グー」である場合の処理（握った瞬間に即発火、かつ一回のグーで1度だけ動作）
    if (hand.isFistActive) {
      elCursor.classList.add('grabbing');
      
      if (!hand.isFistTriggered) {
        hand.isFistTriggered = true;
        triggerSelectAction(hand.hoveredElement);
      }
    } else {
      // グーを解いた場合
      elCursor.classList.remove('grabbing');
      hand.isFistTriggered = false;
    }
  } else {
    // インタラクティブ要素から外れた場合
    clearHoverStates(handIdx, elCursor);
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
    elCursor.classList.remove('hovering', 'grabbing');
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
