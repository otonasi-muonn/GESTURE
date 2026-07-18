import { state, elWebcam, elCanvas, ctx, elHandsDetectedText, elCameraContainer } from './state.js';
import { playClapSound } from './audio.js';
import { transitionTo } from './ui.js';

// 指の起立状態チェック
// y座標は上方向が0、下方向が1。 tip.y < pip.y であれば、指先が関節より「上」にある ＝ 伸びている
export function isFingerExtended(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y < landmarks[pipIdx].y;
}

// 親指の起立状態チェック
export function isThumbExtended(landmarks, handLabel) {
  const tip = landmarks[4];
  const mcp = landmarks[2];
  const distHorizontal = Math.abs(tip.x - mcp.x);
  return distHorizontal > 0.05; // 簡易判定しきい値
}

export function detectFist(landmarks, handLabel) {
  // 4本指（人差し指、中指、薬指、小指）の折りたたみ状態を確認
  const indexFolded = landmarks[8].y > landmarks[6].y;
  const middleFolded = landmarks[12].y > landmarks[10].y;
  const ringFolded = landmarks[16].y > landmarks[14].y;
  const pinkyFolded = landmarks[20].y > landmarks[18].y;
  
  return indexFolded && middleFolded && ringFolded && pinkyFolded;
}

// MediaPipe 検出処理
export function onResults(results) {
  ctx.clearRect(0, 0, elCanvas.width, elCanvas.height);
  
  const numHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
  
  state.hands[0].isDetected = false;
  state.hands[1].isDetected = false;
  
  if (numHands > 0) {
    state.isHandDetected = true;
    elHandsDetectedText.textContent = `手検出中: ${numHands}個`;
    
    // 両手合わせ（クラップ・合掌）による「戻る」検出
    if (state.currentScreen === 'GAME' && numHands >= 2) {
      const hand0_center = results.multiHandLandmarks[0][9];
      const hand1_center = results.multiHandLandmarks[1][9];
      
      const dx = hand0_center.x - hand1_center.x;
      const dy = hand0_center.y - hand1_center.y;
      const dz = hand0_center.z - hand1_center.z;
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      const now = Date.now();
      if (distance < 0.08 && (now - state.lastClapTime > 1500)) {
        state.lastClapTime = now;
        playClapSound();
        transitionTo('HOME');
        return;
      }
    }
    
    // 検出された全ての手（最大2つ）を処理
    for (let i = 0; i < Math.min(2, numHands); i++) {
      const landmarks = results.multiHandLandmarks[i];
      const handMeta = results.multiHandedness[i];
      const handLabel = handMeta.label;
      
      const handState = state.hands[i];
      handState.isDetected = true;
      
      const pointerJoint = landmarks[9];
      handState.targetCursor.x = (1 - pointerJoint.x) * window.innerWidth;
      handState.targetCursor.y = pointerJoint.y * window.innerHeight;
      
      handState.isFistActive = detectFist(landmarks, handLabel);
      drawHandSkeleton(landmarks, i, handState.isFistActive);
    }
  } else {
    state.isHandDetected = false;
    elHandsDetectedText.textContent = '手が見つかりません';
  }
}

// ネオン骨格の描画
export function drawHandSkeleton(landmarks, handIdx, isFistActive) {
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4], // 親指
    [0, 5], [5, 6], [6, 7], [7, 8], // 人差し指
    [5, 9], [9, 10], [10, 11], [11, 12], // 中指
    [9, 13], [13, 14], [14, 15], [15, 16], // 薬指
    [13, 17], [17, 18], [18, 19], [19, 20], // 小指
    [0, 17]
  ];
  
  const w = elCanvas.width;
  const h = elCanvas.height;
  
  let strokeColor = '#00f2fe';
  if (handIdx === 1) {
    strokeColor = '#fe019a';
  }
  if (isFistActive) {
    strokeColor = '#39ff14';
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
  
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < landmarks.length; i++) {
    ctx.beginPath();
    ctx.arc(landmarks[i].x * w, landmarks[i].y * h, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
}

export function initMediaPipe() {
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  
  hands.setOptions({
    maxNumHands: 2,
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
      console.log('Camera started successfully.');
    })
    .catch((err) => {
      console.error('Camera startup failed', err);
    });
}
