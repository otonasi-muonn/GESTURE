import { state, elWebcam, elCameraContainer } from './state.js';
import { initMediaPipe } from './gestures.js';
import { CATEGORIES } from './data.js';

let peer = null;
let activeConnections = []; // 送信機（操作側）に接続している受信機（表示側）のリスト
let p2pConnection = null;   // 受信機（表示側）の時の、送信機への接続

let onSyncStateReceivedCallback = null;

export function registerSyncStateReceivedListener(cb) {
  onSyncStateReceivedCallback = cb;
}

// 画面ヘッダーの同期ステータスバッジの更新
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
    // 受信機モードのみ、「操作権をとる」ボタンを表示する
    if (elBtnTakeControl) elBtnTakeControl.classList.remove('hidden');
  } else {
    elSyncStatus.classList.add('loading');
    if (elSyncIcon) elSyncIcon.textContent = '🔄';
    if (elSyncText) elSyncText.textContent = message;
    if (elBtnTakeControl) elBtnTakeControl.classList.add('hidden');
  }
}

// アプリの現在の状態を全接続ビューアへ配信（送信機用）
export function broadcastState() {
  if (state.syncRole !== 'sender' || !peer || activeConnections.length === 0) return;
  
  const payload = {
    type: 'STATE_UPDATE',
    currentScreen: state.currentScreen,
    activeCategoryId: state.activeCategory ? state.activeCategory.id : null,
    solvedWords: Array.from(state.solvedWords) // Setをシリアライズ可能な配列に変換
  };
  
  activeConnections.forEach(conn => {
    if (conn.open) {
      conn.send(payload);
    }
  });
}

// PeerJSリソースの解放クリーンアップ
export function destroyPeer() {
  if (p2pConnection) {
    try { p2pConnection.close(); } catch(e) {}
    p2pConnection = null;
  }
  
  activeConnections.forEach(conn => {
    try { conn.close(); } catch(e) {}
  });
  activeConnections = [];
  
  if (peer) {
    try { peer.destroy(); } catch(e) {}
    peer = null;
  }
}

// 役割判定および PeerJS 接続の初期化
export function initSync() {
  updateSyncStatus('loading', '役割を判定中...');
  
  const masterId = 'gesture-game-master-sender';
  
  // 1. まず送信機（マスター）としての登録を試みる
  peer = new Peer(masterId);
  
  peer.on('open', (id) => {
    // 登録成功！この端末がジェスチャー操作を行う「送信機（操作側）」となります
    state.syncRole = 'sender';
    console.log('送信機（操作側）として起動成功:', id);
    updateSyncStatus('sender', 'カメラ待機中');
    
    // 操作側なので、カメラ映像コンテナを表示する
    if (elCameraContainer) {
      elCameraContainer.style.display = 'block';
    }
    
    // カメラと手形検出を有効化する
    initMediaPipe();
    
    // 受信機からの接続要求を待ち受ける
    peer.on('connection', (conn) => {
      console.log('受信機が接続しました:', conn.peer);
      activeConnections.push(conn);
      updateSyncStatus('sender', `接続中 (${activeConnections.length}台)`);
      
      // 接続されたらすぐに現在の状態をビューアに送信して同期する
      setTimeout(() => {
        broadcastState();
      }, 500);
      
      // 受信機からの操作権譲渡要求メッセージを待ち受け
      conn.on('data', (payload) => {
        if (payload.type === 'REQUEST_RELEASE_SENDER') {
          console.log('受信機から操作権の引き渡し要求を受信しました。受信モードに移行します。');
          destroyPeer();
          startViewerMode();
        }
      });
      
      conn.on('close', () => {
        activeConnections = activeConnections.filter(c => c !== conn);
        updateSyncStatus('sender', activeConnections.length > 0 
          ? `接続中 (${activeConnections.length}台)` 
          : '接続待機中'
        );
      });
    });
  });
  
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // 送信機IDが既に使用されているため、この端末は「受信機（表示側）」になります
      console.log('他の端末が既に送信機として登録されています。受信機（表示側）モードを開始します。');
      startViewerMode();
    } else {
      console.error('PeerJS 接続エラー:', err);
      updateSyncStatus('loading', '接続エラー。再試行中...');
      setTimeout(initSync, 3000);
    }
  });
}

// 受信機（表示側）モードの起動と送信機への接続
export function startViewerMode() {
  state.syncRole = 'viewer';
  updateSyncStatus('viewer', '送信機を探しています...');
  
  // 受信側はカメラ映像・骨格検出を行わないため非表示・停止にする
  if (elCameraContainer) {
    elCameraContainer.style.display = 'none';
  }
  if (elWebcam) {
    // 起動中のWebカメラがあればストリームを完全に停止してLEDインジケーターを消す
    if (elWebcam.srcObject) {
      try {
        const stream = elWebcam.srcObject;
        stream.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.warn('Failed to stop webcam tracks:', e);
      }
      elWebcam.srcObject = null;
    }
  }
  
  // 受信側はランダムIDでPeerを起動
  peer = new Peer();
  
  peer.on('open', (id) => {
    console.log('受信機が起動しました:', id);
    const masterId = 'gesture-game-master-sender';
    
    // 送信機（マスター）に接続
    p2pConnection = peer.connect(masterId);
    
    p2pConnection.on('open', () => {
      console.log('送信機との同期に成功しました！');
      updateSyncStatus('viewer', '同期完了');
    });
    
    p2pConnection.on('data', (payload) => {
      if (payload.type === 'STATE_UPDATE') {
        console.log('送信機から同期データ受信:', payload);
        
        // グローバルステートの更新
        if (payload.activeCategoryId !== null) {
          state.activeCategory = CATEGORIES.find(c => c.id === payload.activeCategoryId);
        } else {
          state.activeCategory = null;
        }
        
        state.solvedWords = new Set(payload.solvedWords);
        
        // コールバック経由でUIを同期
        if (onSyncStateReceivedCallback) {
          onSyncStateReceivedCallback(payload);
        }
      }
    });
    
    p2pConnection.on('close', () => {
      console.warn('送信機との接続が切れました。再接続します。');
      updateSyncStatus('viewer', '接続切れ。再起動中...');
      setTimeout(startViewerMode, 2000);
    });
    
    p2pConnection.on('error', (err) => {
      console.error('P2P接続エラー:', err);
      setTimeout(startViewerMode, 2000);
    });
  });
  
  peer.on('error', (err) => {
    console.error('PeerJS 受信機起動エラー:', err);
    setTimeout(startViewerMode, 3000);
  });
}

// モジュール読み込み完了時に操作権譲渡のイベントを設定
document.addEventListener('DOMContentLoaded', () => {
  const elBtnTakeControl = document.getElementById('btn-take-control');
  if (elBtnTakeControl) {
    elBtnTakeControl.addEventListener('click', (e) => {
      e.stopPropagation(); // バブリング防止
      
      if (p2pConnection && p2pConnection.open) {
        console.log('現送信機へ操作権リリースを請求します...');
        updateSyncStatus('viewer', '接続切替中...');
        p2pConnection.send({ type: 'REQUEST_RELEASE_SENDER' });
      }
      
      // 送信側が切断処理を行うのを少し待ってから、自身を送信機（Master）として再初期化
      setTimeout(() => {
        destroyPeer();
        initSync();
      }, 600);
    });
  }
});
