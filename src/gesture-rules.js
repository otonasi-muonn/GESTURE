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

export function detectFingerPoses(landmarks) {
  const wrist = landmarks[0];
  const extended = Object.fromEntries(
    Object.entries(FINGER_JOINTS).map(([finger, [tipIndex, jointIndex]]) => [
      finger,
      distance(landmarks[tipIndex], wrist) > distance(landmarks[jointIndex], wrist)
    ])
  );

  // 親指先端(4)と人差し指先端(8)の3D空間上での距離を測定
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  const dz = (thumbTip.z ?? 0) - (indexTip.z ?? 0);
  const pinchDistance = Math.hypot(dx, dy, dz);
  
  // 決定ジェスチャー: 親指と人差し指をつまむ（ピンチ：しきい値0.045）
  const isSelectPose = pinchDistance < 0.045;
  
  const isBackPose = extended.thumb
    && extended.index
    && !extended.middle
    && !extended.ring
    && !extended.pinky;

  return { isSelectPose, isBackPose };
}

export function nextBackGestureState(isLatched, isBackPose) {
  return {
    isLatched: isBackPose,
    shouldTrigger: !isLatched && isBackPose
  };
}
