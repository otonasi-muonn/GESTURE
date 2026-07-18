import { state, elScreenHome, elScreenGame, elCategoryList, elWordList, elActiveCategoryTitle } from './state.js';
import { CATEGORIES } from './data.js';
import { playSuccessSound, playBuzzerSound, playClapSound } from './audio.js';
import { canChangeLocalState } from './sync-rules.js';

// カテゴリー選択画面の生成
export function renderCategories() {
  elCategoryList.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const card = document.createElement('div');
    card.className = `category-card cat-${cat.id} glow-hover`;
    card.dataset.id = cat.id;
    card.innerHTML = `
      <div class="card-glow"></div>
      <span class="cat-icon">${cat.icon}</span>
      <h3>${cat.name}</h3>
      <p>${cat.desc}</p>
    `;
    
    // タッチ・マウスクリック時のフォールバック
    card.addEventListener('click', () => {
      selectCategory(cat.id);
    });
    
    elCategoryList.appendChild(card);
  });
}

// お題一覧画面の生成
export function renderWords() {
  if (!state.activeCategory) return;
  
  elActiveCategoryTitle.textContent = `${state.activeCategory.icon} ${state.activeCategory.name}`;
  
  const elViewerActiveCard = document.getElementById('viewer-active-card');
  
  if (state.syncRole === 'viewer') {
    // 受信機モード: 単一のお題表示
    elWordList.classList.add('hidden');
    if (elViewerActiveCard) {
      elViewerActiveCard.classList.remove('hidden');
      const elWordDisplay = elViewerActiveCard.querySelector('.viewer-word-display');
      if (state.solvedWords.size > 0) {
        const selectedIndex = Array.from(state.solvedWords)[0];
        const selectedWord = state.activeCategory.words[selectedIndex];
        elWordDisplay.innerHTML = `
          <span class="viewer-word-num">${selectedIndex + 1}</span>
          <span class="viewer-word-text neon-text-green">${selectedWord}</span>
        `;
      } else {
        elWordDisplay.innerHTML = `
          <span class="pulse-text">ジェスチャー回答を待っています...</span>
        `;
      }
    }
  } else {
    // 送信機モード: グリッド表示
    elWordList.classList.remove('hidden');
    if (elViewerActiveCard) {
      elViewerActiveCard.classList.add('hidden');
    }
    
    elWordList.innerHTML = '';
    state.activeCategory.words.forEach((word, index) => {
      const card = document.createElement('div');
      card.className = 'word-card glow-hover';
      card.dataset.index = index;
      if (state.solvedWords.has(index)) {
        card.classList.add('correct');
      }
      
      card.innerHTML = `
        <span class="word-num">${index + 1}</span>
        <span class="word-text">${word}</span>
      `;
      
      // タッチ・マウスクリック時のフォールバック
      card.addEventListener('click', () => {
        toggleWordSolved(index);
      });
      
      elWordList.appendChild(card);
    });
  }
}

export function refreshRoleUI() {
  if (state.currentScreen === 'GAME') renderWords();
}

let onStateChangeCallback = null;
export function registerStateChangeListener(cb) {
  onStateChangeCallback = cb;
}

function notifyStateChange() {
  if (onStateChangeCallback) {
    onStateChangeCallback();
  }
}

// 画面遷移処理
export function transitionTo(screenName) {
  state.currentScreen = screenName;
  
  if (screenName === 'HOME') {
    elScreenGame.classList.remove('active');
    setTimeout(() => {
      elScreenGame.style.display = 'none';
      elScreenHome.style.display = 'flex';
      setTimeout(() => elScreenHome.classList.add('active'), 20);
    }, 300);
  } else {
    elScreenHome.classList.remove('active');
    setTimeout(() => {
      elScreenHome.style.display = 'none';
      elScreenGame.style.display = 'flex';
      renderWords();
      setTimeout(() => elScreenGame.classList.add('active'), 20);
    }, 300);
  }
  notifyStateChange();
}

let lastActionTime = 0;
const ACTION_COOLDOWN_MS = 500;

// カテゴリー選択実行
export function selectCategory(id) {
  if (!canChangeLocalState(state.syncRole)) return;
  
  const now = performance.now();
  if (now - lastActionTime < ACTION_COOLDOWN_MS) return;
  lastActionTime = now;
  
  state.activeCategory = CATEGORIES.find(c => c.id === Number(id));
  state.solvedWords.clear();
  playSuccessSound();
  transitionTo('GAME');
  // transitionTo が内部で notifyStateChange を呼び出します
}

// お題選択トグル（他のお題を選択すると、以前の選択は自動解除されます。選択済みのものを再選択しても解除されません）
export function toggleWordSolved(index) {
  if (!canChangeLocalState(state.syncRole)) return;
  
  const now = performance.now();
  if (now - lastActionTime < ACTION_COOLDOWN_MS) return;
  lastActionTime = now;
  
  index = Number(index);
  if (state.solvedWords.has(index)) {
    // 既に選択されている場合は解除しない
    return;
  }
  
  state.solvedWords.clear(); // 以前の選択を解除
  state.solvedWords.add(index);
  playSuccessSound();
  renderWords();
  notifyStateChange();
}

// リセット処理
export function resetCurrentRound() {
  if (!canChangeLocalState(state.syncRole)) return;
  
  const now = performance.now();
  if (now - lastActionTime < ACTION_COOLDOWN_MS) return;
  lastActionTime = now;
  
  state.solvedWords.clear();
  playBuzzerSound();
  renderWords();
  notifyStateChange();
}
