import { state, elBtnSoundInit, elBtnCameraToggle, elBtnBackManual, elBtnResetRound, elCameraContainer, elCanvas } from './src/state.js';
import { initAudio } from './src/audio.js';
import { renderCategories, resetCurrentRound, transitionTo, registerStateChangeListener, renderWords } from './src/ui.js';
import { updateCursorSmoothLoop, toggleCameraView } from './src/cursor.js';
import { initSync, broadcastState, registerSyncStateReceivedListener } from './src/sync.js';

function initApp() {
  // 初期画面の描画
  renderCategories();
  
  // 共通イベントリスナー登録
  elBtnSoundInit.addEventListener('click', initAudio);
  elBtnCameraToggle.addEventListener('click', toggleCameraView);
  elBtnBackManual.addEventListener('click', () => {
    transitionTo('HOME');
  });
  elBtnResetRound.addEventListener('click', resetCurrentRound);
  
  // カメラ背景キャンバスのサイズフィッティング
  function resizeCanvas() {
    elCanvas.width = elCameraContainer.clientWidth;
    elCanvas.height = elCameraContainer.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  
  // スムースカーソルアニメーションループの開始
  updateCursorSmoothLoop();
  
  // 送信機側での状態変化時に自動でブロードキャスト
  registerStateChangeListener(() => {
    broadcastState();
  });
  
  // 受信機側で同期データを受け取った時の描画処理
  registerSyncStateReceivedListener((payload) => {
    if (state.currentScreen !== payload.currentScreen) {
      transitionTo(payload.currentScreen);
    } else if (state.currentScreen === 'GAME') {
      renderWords(); // お題画面ならカードの点灯状態を再描画
    }
  });
  
  // P2P同期・役割判定の初期化起動（送信機なら内部でカメラ/MediaPipeも起動されます）
  initSync();
}

// DOM読み込み完了時にアプリをブートストラップ
document.addEventListener('DOMContentLoaded', initApp);
