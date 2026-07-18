import { state, elBtnSoundInit } from './state.js';

export function initAudio() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    elBtnSoundInit.classList.add('active-hover');
    elBtnSoundInit.querySelector('.label').textContent = 'サウンド有効';
    playSuccessSound(); // 初期動作テスト音
  }
}

export function playSound(freqs, type = 'sine', duration = 0.1, delay = 0, volume = 0.1) {
  if (!state.audioContext) return;
  
  setTimeout(() => {
    try {
      const osc = state.audioContext.createOscillator();
      const gainNode = state.audioContext.createGain();
      
      osc.type = type;
      osc.connect(gainNode);
      gainNode.connect(state.audioContext.destination);
      
      // 音量制御
      gainNode.gain.setValueAtTime(volume, state.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, state.audioContext.currentTime + duration);
      
      // 周波数設定 (スイープ対応)
      if (Array.isArray(freqs)) {
        osc.frequency.setValueAtTime(freqs[0], state.audioContext.currentTime);
        if (freqs[1]) {
          osc.frequency.exponentialRampToValueAtTime(freqs[1], state.audioContext.currentTime + duration);
        }
      } else {
        osc.frequency.setValueAtTime(freqs, state.audioContext.currentTime);
      }
      
      osc.start();
      osc.stop(state.audioContext.currentTime + duration);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }, delay);
}

// 効果音定義
export const playHoverSound = () => playSound(800, 'sine', 0.05, 0, 0.05);
export const playSuccessSound = () => {
  playSound(523.25, 'sine', 0.15, 0, 0.1); // C5
  playSound(659.25, 'sine', 0.15, 80, 0.1); // E5
  playSound(784.00, 'sine', 0.25, 160, 0.1); // G5
};
export const playClapSound = () => playSound([600, 250], 'triangle', 0.25, 0, 0.15);
export const playBuzzerSound = () => {
  playSound(130, 'sawtooth', 0.3, 0, 0.15);
  playSound(130, 'sawtooth', 0.3, 100, 0.15);
};
