// アプリのグローバル状態
export const state = {
  currentScreen: 'HOME', // 'HOME' | 'GAME'
  activeCategory: null,
  solvedWords: new Set(), // 選択中のお題インデックスの保持（単一選択）
  syncRole: 'loading', // 'sender' | 'viewer' | 'loading'
  
  // ポインター＆ジェスチャー制御（両手分）
  hands: [
    { cursor: { x: 0, y: 0 }, targetCursor: { x: 0, y: 0 }, isDetected: false, hoveredElement: null, fistProgress: 0, fistStartTime: null, isFistActive: false, isFistTriggered: false },
    { cursor: { x: 0, y: 0 }, targetCursor: { x: 0, y: 0 }, isDetected: false, hoveredElement: null, fistProgress: 0, fistStartTime: null, isFistActive: false, isFistTriggered: false }
  ],
  isHandDetected: false,
  
  // 両手合掌の制御
  lastClapTime: 0,
  
  // カメラ設定
  cameraOpacityIndex: 0, // OPACITIES 配列のインデックス
  audioContext: null
};

// UIエレメントの取得
export const elScreenHome = document.getElementById('screen-home');
export const elScreenGame = document.getElementById('screen-game');
export const elCategoryList = document.getElementById('category-list');
export const elWordList = document.getElementById('word-list');
export const elActiveCategoryTitle = document.getElementById('active-category-title');
export const elCameraContainer = document.getElementById('camera-container');
export const elWebcam = document.getElementById('webcam');
export const elCanvas = document.getElementById('canvas-overlay');
export const ctx = elCanvas.getContext('2d');

export const elBtnSoundInit = document.getElementById('btn-sound-init');
export const elBtnCameraToggle = document.getElementById('btn-camera-toggle');
export const elBtnBackManual = document.getElementById('btn-back-manual');
export const elBtnResetRound = document.getElementById('btn-reset-round');
export const elHandsDetectedText = document.getElementById('hands-detected-text');
