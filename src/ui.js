import { state, elScreenHome, elScreenGame, elCategoryList, elWordList, elActiveCategoryTitle } from './state.js';
import { CATEGORIES } from './data.js';
import { playSuccessSound, playBuzzerSound, playClapSound } from './audio.js';

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
  
  elWordList.innerHTML = '';
  elActiveCategoryTitle.textContent = `${state.activeCategory.icon} ${state.activeCategory.name}`;
  
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

// 画面遷移処理
export function transitionTo(screenName) {
  state.currentScreen = screenName;
  state.hands.forEach(h => {
    h.fistProgress = 0;
    h.fistStartTime = null;
  });
  
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
}

// カテゴリー選択実行
export function selectCategory(id) {
  state.activeCategory = CATEGORIES.find(c => c.id === Number(id));
  state.solvedWords.clear();
  playSuccessSound();
  transitionTo('GAME');
}

// お題選択トグル（他のお題を選択すると、以前の選択は自動解除されます）
export function toggleWordSolved(index) {
  index = Number(index);
  if (state.solvedWords.has(index)) {
    state.solvedWords.delete(index);
    playBuzzerSound();
  } else {
    state.solvedWords.clear(); // 以前の選択を解除
    state.solvedWords.add(index);
    playSuccessSound();
  }
  renderWords();
}

// リセット処理
export function resetCurrentRound() {
  state.solvedWords.clear();
  playBuzzerSound();
  renderWords();
}
