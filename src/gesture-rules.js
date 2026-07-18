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

  // 決定ジェスチャー: グー（主要4本指：人差し指・中指・薬指・小指がすべて折られている状態）
  // 親指の開閉状態は問わないため、非常に安定して判定されます
  const isSelectPose = !extended.index
    && !extended.middle
    && !extended.ring
    && !extended.pinky;
  
  // 戻るジェスチャー: チョキ（人差し指・中指が伸びており、薬指・小指が折られている状態）
  const isBackPose = extended.index
    && extended.middle
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
