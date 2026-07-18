import { state, elCameraContainer } from './state.js';
import { initMediaPipe, stopMediaPipe } from './gestures.js';
import { refreshRoleUI } from './ui.js';
import { CATEGORIES } from './data.js';
import { MAX_TAKEOVER_CLAIM_ATTEMPTS, shouldAttemptTakeoverClaim } from './sync-rules.js';

export const MASTER_PEER_ID = 'gesture-game-master-sender';
export const TAKEOVER_CLAIM_RETRY_DELAY_MS = 500;
export { MAX_TAKEOVER_CLAIM_ATTEMPTS };

let peer = null;
let activeConnections = [];
let p2pConnection = null;
let restartTimer = null;
let takeoverInProgress = false;
let onSyncStateReceivedCallback = null;

export function registerSyncStateReceivedListener(cb) {
  onSyncStateReceivedCallback = cb;
}

export function updateSyncStatus(role, message) {
  const elSyncStatus = document.getElementById('sync-status');
  if (!elSyncStatus) return;

  const elSyncIcon = elSyncStatus.querySelector('.sync-icon');
  const elSyncText = elSyncStatus.querySelector('.sync-text');
  const elBtnTakeControl = document.getElementById('btn-take-control');
  elSyncStatus.className = 'sync-badge';

  if (role === 'sender') {
    elSyncStatus.classList.add('sender');
    if (elSyncIcon) elSyncIcon.textContent = '📡';
    if (elSyncText) elSyncText.textContent = `送信機: ${message}`;
    if (elBtnTakeControl) elBtnTakeControl.classList.add('hidden');
  } else if (role === 'viewer') {
    elSyncStatus.classList.add('viewer');
    if (elSyncIcon) elSyncIcon.textContent = '📱';
    if (elSyncText) elSyncText.textContent = `受信機: ${message}`;
    if (elBtnTakeControl) elBtnTakeControl.classList.remove('hidden');
  } else {
    elSyncStatus.classList.add('loading');
    if (elSyncIcon) elSyncIcon.textContent = '🔄';
    if (elSyncText) elSyncText.textContent = message;
    if (elBtnTakeControl) elBtnTakeControl.classList.add('hidden');
  }
}

function clearRestartTimer() {
  if (restartTimer !== null) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart(message, delay, restart) {
  clearRestartTimer();
  restartTimer = setTimeout(() => {
    restartTimer = null;
    restart();
  }, delay);
  updateSyncStatus('loading', message);
}

function setRole(role, message) {
  state.syncRole = role;
  updateSyncStatus(role, message);
  refreshRoleUI();
}

function showCamera(show) {
  if (elCameraContainer) elCameraContainer.style.display = show ? 'block' : 'none';
}

export function broadcastState() {
  if (state.syncRole !== 'sender' || !peer || activeConnections.length === 0) return;
  const payload = {
    type: 'STATE_UPDATE',
    currentScreen: state.currentScreen,
    activeCategoryId: state.activeCategory ? state.activeCategory.id : null,
    solvedWords: Array.from(state.solvedWords)
  };
  activeConnections.forEach((conn) => {
    if (conn.open) conn.send(payload);
  });
}

export function destroyPeer() {
  clearRestartTimer();
  const connection = p2pConnection;
  p2pConnection = null;
  try { connection?.close(); } catch (error) { console.warn('P2P cleanup failed', error); }

  const connections = activeConnections;
  activeConnections = [];
  connections.forEach((conn) => {
    try { conn.close(); } catch (error) { console.warn('Connection cleanup failed', error); }
  });

  const currentPeer = peer;
  peer = null;
  try { currentPeer?.destroy(); } catch (error) { console.warn('Peer cleanup failed', error); }
}

function scheduleViewerRestart(message, delay = 2000) {
  scheduleRestart(message, delay, () => startViewerMode());
}

function scheduleSenderRestart(message, delay = 3000) {
  scheduleRestart(message, delay, () => initSync());
}

function reconnectCurrentPeer(currentPeer, restart) {
  if (peer !== currentPeer || !currentPeer.disconnected || currentPeer.destroyed) return;
  try {
    currentPeer.reconnect();
  } catch (error) {
    console.error('PeerJS reconnect failed', error);
    restart('接続エラー。再試行中...');
  }
}

function handleSenderConnection(senderPeer, conn) {
  if (peer !== senderPeer) return;
  activeConnections.push(conn);
  updateSyncStatus('sender', `接続中 (${activeConnections.length}台)`);

  conn.on('open', () => {
    if (peer !== senderPeer || !activeConnections.includes(conn)) return;
    broadcastState();
  });
  conn.on('data', (payload) => {
    if (peer !== senderPeer || !activeConnections.includes(conn)) return;
    if (payload.type === 'REQUEST_RELEASE_SENDER') {
      destroyPeer();
      startViewerMode();
    }
  });
  conn.on('close', () => {
    if (peer !== senderPeer || !activeConnections.includes(conn)) return;
    activeConnections = activeConnections.filter((activeConnection) => activeConnection !== conn);
    updateSyncStatus('sender', activeConnections.length > 0 ? `接続中 (${activeConnections.length}台)` : '接続待機中');
  });
  conn.on('error', (error) => {
    if (peer !== senderPeer || !activeConnections.includes(conn)) return;
    console.error('Viewer connection error', error);
  });
}

function claimMaster(attempt) {
  if (!shouldAttemptTakeoverClaim(attempt)) {
    takeoverInProgress = false;
    startViewerMode();
    return;
  }
  initSync({ takeoverAttempt: attempt });
}

function retryTakeoverClaim(attempt) {
  if (!shouldAttemptTakeoverClaim(attempt)) {
    takeoverInProgress = false;
    startViewerMode();
    return;
  }
  scheduleRestart('操作権を確認中...', TAKEOVER_CLAIM_RETRY_DELAY_MS, () => claimMaster(attempt));
}

function retrySenderInitialization(takeoverAttempt, message) {
  if (takeoverAttempt) {
    retryTakeoverClaim(takeoverAttempt + 1);
    return;
  }
  scheduleSenderRestart(message);
}

export function initSync({ takeoverAttempt = 0 } = {}) {
  destroyPeer();
  updateSyncStatus('loading', takeoverAttempt ? '操作権を確認中...' : '役割を判定中...');
  let senderPeer;
  try {
    senderPeer = new Peer(MASTER_PEER_ID);
  } catch (error) {
    console.error('PeerJS sender init error', error);
    retrySenderInitialization(takeoverAttempt, '接続エラー。再試行中...');
    return;
  }
  peer = senderPeer;

  senderPeer.on('open', (id) => {
    if (peer !== senderPeer) return;
    takeoverInProgress = false;
    setRole('sender', 'カメラ待機中');
    showCamera(true);
    void initMediaPipe();
    console.log('送信機（操作側）として起動成功:', id);
  });
  senderPeer.on('connection', (conn) => handleSenderConnection(senderPeer, conn));
  senderPeer.on('disconnected', () => reconnectCurrentPeer(
    senderPeer,
    (message) => retrySenderInitialization(takeoverAttempt, message)
  ));
  senderPeer.on('close', () => {
    if (peer !== senderPeer) return;
    retrySenderInitialization(takeoverAttempt, '接続切れ。再起動中...');
  });
  senderPeer.on('error', (error) => {
    if (peer !== senderPeer) return;
    if (error.type === 'unavailable-id') {
      if (takeoverAttempt) {
        retryTakeoverClaim(takeoverAttempt + 1);
      } else {
        takeoverInProgress = false;
        startViewerMode();
      }
      return;
    }
    console.error('PeerJS sender error', error);
    retrySenderInitialization(takeoverAttempt, '接続エラー。再試行中...');
  });
}

export function startViewerMode() {
  const wasSender = state.syncRole === 'sender';
  destroyPeer();
  setRole('viewer', '送信機を探しています...');
  showCamera(false);
  if (wasSender) void stopMediaPipe();

  let viewerPeer;
  try {
    viewerPeer = new Peer();
  } catch (error) {
    console.error('PeerJS viewer init error', error);
    scheduleViewerRestart('接続エラー。再試行中...', 3000);
    return;
  }
  peer = viewerPeer;
  viewerPeer.on('open', (id) => {
    if (peer !== viewerPeer) return;
    console.log('受信機が起動しました:', id);
    const connection = viewerPeer.connect(MASTER_PEER_ID);
    p2pConnection = connection;
    connection.on('open', () => {
      if (peer !== viewerPeer || p2pConnection !== connection) return;
      updateSyncStatus('viewer', '同期完了');
    });
    connection.on('data', (payload) => {
      if (peer !== viewerPeer || p2pConnection !== connection || payload.type !== 'STATE_UPDATE') return;
      state.activeCategory = payload.activeCategoryId === null ? null : CATEGORIES.find((category) => category.id === payload.activeCategoryId);
      state.solvedWords = new Set(payload.solvedWords);
      onSyncStateReceivedCallback?.(payload);
    });
    connection.on('close', () => {
      if (peer !== viewerPeer || p2pConnection !== connection) return;
      if (takeoverInProgress) return;
      scheduleViewerRestart('接続切れ。再起動中...');
    });
    connection.on('error', (error) => {
      if (peer !== viewerPeer || p2pConnection !== connection) return;
      if (takeoverInProgress) return;
      console.error('P2P connection error', error);
      scheduleViewerRestart('接続エラー。再試行中...');
    });
  });
  viewerPeer.on('disconnected', () => reconnectCurrentPeer(viewerPeer, scheduleViewerRestart));
  viewerPeer.on('close', () => {
    if (peer !== viewerPeer) return;
    scheduleViewerRestart('接続切れ。再起動中...');
  });
  viewerPeer.on('error', (error) => {
    if (peer !== viewerPeer) return;
    console.error('PeerJS viewer error', error);
    scheduleViewerRestart('接続エラー。再試行中...', 3000);
  });
}

function setupTakeoverButton() {
  const button = document.getElementById('btn-take-control');
  button?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (state.syncRole !== 'viewer' || takeoverInProgress) return;
    takeoverInProgress = true;
    if (p2pConnection?.open) p2pConnection.send({ type: 'REQUEST_RELEASE_SENDER' });
    retryTakeoverClaim(1);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupTakeoverButton);
} else {
  setupTakeoverButton();
}
