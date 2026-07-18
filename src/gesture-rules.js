const FINGER_JOINTS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18]
];

function distance(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const dz = (first.z ?? 0) - (second.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

export function detectFistByDistance(landmarks) {
  const wrist = landmarks[0];
  return FINGER_JOINTS.every(([tipIndex, pipIndex]) => (
    distance(landmarks[tipIndex], wrist) < distance(landmarks[pipIndex], wrist)
  ));
}

export function nextFistState(hand, isFistDetected) {
  const fistDetectedFrames = isFistDetected ? (hand.fistDetectedFrames ?? 0) + 1 : 0;
  const fistReleasedFrames = isFistDetected ? 0 : (hand.fistReleasedFrames ?? 0) + 1;

  let isFistActive = hand.isFistActive;
  if (!isFistActive && fistDetectedFrames >= 3) {
    isFistActive = true;
  } else if (isFistActive && fistReleasedFrames >= 2) {
    isFistActive = false;
  }

  return { isFistActive, fistDetectedFrames, fistReleasedFrames };
}
