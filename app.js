import { state, elBtnSoundInit, elBtnCameraToggle, elBtnBackManual, elBtnResetRound, elCameraContainer, elCanvas } from './src/state.js';
import { initAudio } from './src/audio.js';
import { renderCategories, resetCurrentRound, transitionTo } from './src/ui.js';
import { updateCursorSmoothLoop, toggleCameraView } from './src/cursor.js';
import { initMediaPipe } from './src/gestures.js';

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
  
  // MediaPipe Hands & カメラシステムの起動
  initMediaPipe();
}

// DOM読み込み完了時にアプリをブートストラップ
document.addEventListener('DOMContentLoaded', initApp);
