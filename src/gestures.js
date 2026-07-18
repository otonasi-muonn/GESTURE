import { state, elWebcam, elCanvas, ctx, elHandsDetectedText } from './state.js';
import { playClapSound } from './audio.js';
import { transitionTo } from './ui.js';
import { processGestureSelection } from './cursor.js';
import { detectFingerPoses, nextBackGestureState } from './gesture-rules.js';

let activeMediaPipe = null;
let mediaPipeLifecycleQueue = Promise.resolve();

function resetHandState(handState, handIndex) {
  handState.hoveredElement?.classList.remove('hovered');
  handState.cursor.x = 0;
  handState.cursor.y = 0;
  handState.targetCursor.x = 0;
  handState.targetCursor.y = 0;
  handState.isDetected = false;
  handState.hoveredElement = null;
  handState.isSelectPose = false;
  handState.isBackPose = false;
  document.getElementById(`hand-cursor-${handIndex}`)?.classList.remove('hovering', 'selecting');
  document.getElementById(`hand-cursor-${handIndex}`)?.classList.add('hidden');
}

function setCameraUnavailable() {
  elHandsDetectedText.textContent = 'カメラ利用不可（マウス／タッチ操作可）';
  elHandsDetectedText.closest('.camera-indicator')?.classList.add('camera-unavailable');
}

function clearCameraUnavailable() {
  elHandsDetectedText.closest('.camera-indicator')?.classList.remove('camera-unavailable');
}

// MediaPipe 検出処理
export function onResults(results) {
  ctx.clearRect(0, 0, elCanvas.width, elCanvas.height);
  
  const numHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
  
  const detectedHands = results.multiHandLandmarks?.slice(0, state.hands.length) ?? [];
  const poses = detectedHands.map(detectFingerPoses);

  state.hands.forEach((handState, index) => {
    handState.isDetected = false;
    handState.isSelectPose = poses[index]?.isSelectPose ?? false;
    handState.isBackPose = poses[index]?.isBackPose ?? false;
  });

  const isAnyBackPose = poses.some((pose) => pose.isBackPose);
  const backGesture = nextBackGestureState(state.backGestureLatched, isAnyBackPose);
  state.backGestureLatched = backGesture.isLatched;
  
  if (numHands > 0) {
    state.isHandDetected = true;
    elHandsDetectedText.textContent = `手検出中: ${numHands}個`;
    
    if (backGesture.shouldTrigger && state.syncRole === 'sender' && state.currentScreen === 'GAME') {
      playClapSound();
      transitionTo('HOME');
    }
    
    // 検出された全ての手（最大2つ）を処理
    for (let i = 0; i < Math.min(2, numHands); i++) {
      const landmarks = results.multiHandLandmarks[i];
      const handState = state.hands[i];
      handState.isDetected = true;
      
      const pointerJoint = landmarks[8];
      handState.targetCursor.x = (1 - pointerJoint.x) * window.innerWidth;
      handState.targetCursor.y = pointerJoint.y * window.innerHeight;

      const isActionPose = handState.isSelectPose || handState.isBackPose;
      drawHandSkeleton(landmarks, i, isActionPose);

      if (state.syncRole === 'sender' && !isAnyBackPose) {
        processGestureSelection(i);
      }
    }
  } else {
    state.isHandDetected = false;
    elHandsDetectedText.textContent = '手が見つかりません';
  }
}

// ネオン骨格の描画
export function drawHandSkeleton(landmarks, handIdx, isActionPose) {
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
  if (isActionPose) {
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

function enqueueMediaPipeLifecycle(operation) {
  const nextOperation = mediaPipeLifecycleQueue.then(operation, operation);
  mediaPipeLifecycleQueue = nextOperation.catch(() => undefined);
  return nextOperation;
}

function resetMediaPipeUi() {
  state.hands.forEach(resetHandState);
  state.isHandDetected = false;
  state.backGestureLatched = false;
  elHandsDetectedText.textContent = '手が見つかりません';
  clearCameraUnavailable();
  ctx.clearRect(0, 0, elCanvas.width, elCanvas.height);
}

async function safelyStopResource(stop, label) {
  if (!stop) return;
  try {
    await stop();
  } catch (error) {
    console.warn(`${label} cleanup failed`, error);
  }
}

function stopVideoTracks(video = elWebcam) {
  if (!video) return;
  const stream = video.srcObject;
  if (stream?.getTracks) {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.warn('Camera track cleanup failed', error);
      }
    });
  }
  video.srcObject = null;
}

async function stopActiveMediaPipe() {
  const active = activeMediaPipe;
  if (!active) {
    resetMediaPipeUi();
    return;
  }

  active.stopping = true;
  activeMediaPipe = null;

  const ownedStream = active.video.srcObject;
  const startWasPending = !active.startSettled;
  await safelyStopResource(active.camera.stop?.bind(active.camera), 'Camera');
  stopVideoTracks(active.video);
  if (startWasPending) {
    active.startPromise.then(
      () => safelyStopResource(active.camera.stop?.bind(active.camera), 'Camera'),
      () => undefined
    );
  }
  if (elWebcam.srcObject === ownedStream) {
    elWebcam.srcObject = null;
  } else {
    stopVideoTracks();
  }
  await safelyStopResource(active.hands.close?.bind(active.hands), 'Hands');
  resetMediaPipeUi();
}

function enqueueFailedMediaPipeCleanup(active) {
  void enqueueMediaPipeLifecycle(async () => {
    if (activeMediaPipe !== active || active.stopping) return;
    await stopActiveMediaPipe();
    setCameraUnavailable();
  });
}

export function initMediaPipe() {
  return enqueueMediaPipeLifecycle(async () => {
    await stopActiveMediaPipe();

    let hands = null;
    let camera = null;
    let cameraVideo = null;
    try {
      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
      });
      hands.onResults(onResults);

      cameraVideo = document.createElement('video');
      cameraVideo.autoplay = true;
      cameraVideo.playsInline = true;
      cameraVideo.muted = true;

      let active = null;
      camera = new Camera(cameraVideo, {
        onFrame: async () => {
          if (!active || activeMediaPipe !== active || active.stopping) return;
          await hands.send({ image: cameraVideo });
        },
        width: 640,
        height: 480
      });
      active = { hands, camera, video: cameraVideo, startPromise: null, startSettled: false, stopping: false };
      activeMediaPipe = active;
      active.startPromise = Promise.resolve().then(() => camera.start());
      active.startPromise.then(
        () => {
          active.startSettled = true;
          if (activeMediaPipe === active && !active.stopping) {
            stopVideoTracks();
            elWebcam.srcObject = cameraVideo.srcObject;
            clearCameraUnavailable();
            console.log('Camera started successfully.');
          }
        },
        (error) => {
          active.startSettled = true;
          if (activeMediaPipe === active && !active.stopping) {
            setCameraUnavailable();
            console.error('Camera startup failed', error);
            enqueueFailedMediaPipeCleanup(active);
          }
        }
      );
    } catch (error) {
      await safelyStopResource(camera?.stop?.bind(camera), 'Camera');
      stopVideoTracks(cameraVideo);
      stopVideoTracks();
      await safelyStopResource(hands?.close?.bind(hands), 'Hands');
      resetMediaPipeUi();
      setCameraUnavailable();
      console.error('Camera startup failed', error);
    }
  });
}

export function stopMediaPipe() {
  return enqueueMediaPipeLifecycle(stopActiveMediaPipe);
}
