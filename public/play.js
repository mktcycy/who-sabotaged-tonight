'use strict';

const roomCode = App.roomFromUrl();
let playerToken = localStorage.getItem(`playerToken:${roomCode}`);
const app = document.querySelector('#app');
const statusBar = document.querySelector('#status');
let state = null;
let busy = false;
let pollTimer = null;

if (!/^\d{4}$/.test(roomCode)) {
  app.innerHTML = '<section class="card"><h2>房號格式錯誤</h2><a class="btn" href="/">回首頁</a></section>';
} else if (!playerToken) {
  renderJoin();
} else {
  connect();
}

function renderJoin(message = '') {
  statusBar.classList.add('hidden');
  app.innerHTML = `<div class="brand"><div class="brand-mark">搞</div><div><h1>加入房間 ${roomCode}</h1><p>先取一個同事叫得出口的名字</p></div><a class="rules-link brand-action" href="/rules.html" target="_blank" rel="noopener">規則</a></div>
    <section class="card"><form id="join-form"><div class="field"><label for="name">暱稱</label><input id="name" class="input" maxlength="16" required autofocus></div><button class="btn full">加入公司</button></form>${message ? `<div class="error">${App.escapeHtml(message)}</div>` : ''}</section>`;
  document.querySelector('#join-form').addEventListener('submit', join);
}

async function join(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await App.api(`/api/rooms/${roomCode}/join`, { method: 'POST', body: { name: document.querySelector('#name').value } });
    playerToken = result.playerToken;
    localStorage.setItem(`playerToken:${roomCode}`, playerToken);
    connect();
  } catch (error) {
    renderJoin(error.message);
  }
}

function connect() {
  const events = new EventSource(`/api/rooms/${roomCode}/events?token=${encodeURIComponent(playerToken)}`);
  events.addEventListener('state', (message) => {
    applyState(JSON.parse(message.data));
  });
  events.onerror = () => {
    if (!state) app.innerHTML = '<section class="card notice">即時連線切換中，正在同步房間…</section>';
  };
  events.addEventListener('disbanded', () => showDisbanded());
  pollState();
  if (!pollTimer) pollTimer = setInterval(pollState, 2000);
}

function applyState(nextState) {
  const changed = !state || nextState.phaseVersion !== state.phaseVersion
    || nextState.voteProgress.submitted !== state.voteProgress.submitted
    || JSON.stringify(nextState.players) !== JSON.stringify(state.players)
    || nextState.private?.hasVoted !== state.private?.hasVoted;
  state = nextState;
  state.receivedAt = Date.now();
  if (changed) render();
}

async function pollState() {
  if (!playerToken) return;
  try {
    applyState(await App.api(`/api/rooms/${roomCode}/view?token=${encodeURIComponent(playerToken)}`));
  } catch (error) {
    if (/找不到房間/.test(error.message)) {
      showDisbanded();
    } else if (!state && /驗證/.test(error.message)) {
      localStorage.removeItem(`playerToken:${roomCode}`);
      playerToken = null;
      renderJoin('無法恢復原玩家。若遊戲已開始，請聯絡 Host。');
    }
  }
}

function showDisbanded() {
  clearInterval(pollTimer);
  pollTimer = null;
  state = null;
  statusBar.classList.add('hidden');
  localStorage.removeItem(`playerToken:${roomCode}`);
  playerToken = null;
  app.innerHTML = '<section class="card role"><div class="role-icon">🏁</div><h2>Host 已解散遊戲</h2><p class="subtitle">這個房間已關閉，遊戲進度也已刪除。</p><a class="btn" href="/">回首頁</a></section>';
}

function renderStatus() {
  statusBar.classList.remove('hidden');
  statusBar.innerHTML = `<div class="round-pill">${state.round ? `${state.round}/8` : state.roomCode}</div><div class="stats">${App.statsHtml(state.company)}</div><div class="header-actions"><a class="rules-link" href="/rules.html" target="_blank" rel="noopener">規則</a><div class="phase-pill">${App.phaseLabel(state.phase)}</div></div>`;
}

function secretSummary() {
  if (!state.private) return '';
  const goal = state.private.role === 'SABOTEUR' ? state.private.saboteurGoal : state.private.mission;
  return `<details class="card secret"><summary><strong>我的秘密目標</strong></summary><p>${App.escapeHtml(goal)}</p>${state.private.partners.length ? `<p>搞事同伴：<strong>${state.private.partners.map(App.escapeHtml).join('、')}</strong></p>` : ''}</details>`;
}

function lobbyHtml() {
  return `<section class="card role"><div class="role-icon">🏢</div><div class="eyebrow">房間 ${state.roomCode}</div><h2>你已加入公司</h2><p class="subtitle">等待 Host 開始，目前 ${state.playerCount} 人。</p></section>
    <section class="card"><h3>玩家名單</h3><div class="players">${state.players.map((player) => `<div class="player"><span>${App.escapeHtml(player.name)}</span><i class="dot ${player.connected ? 'online' : ''}"></i></div>`).join('')}</div></section>`;
}

function roleHtml() {
  const saboteur = state.private.role === 'SABOTEUR';
  return `<section class="card role secret ${saboteur ? 'saboteur' : ''}"><div class="role-icon">${saboteur ? '🕶️' : '🧑‍💼'}</div><div class="eyebrow">你的身份</div><h2>${saboteur ? '搞事仔' : '普通員工'}</h2>
    <p class="subtitle">${saboteur ? '表面上一起救公司，實際上讓風險走在刺激的邊緣。' : '公司必須活過 Round 8，你的秘密任務才會判定。'}</p>
    <div class="intel"><strong>秘密目標</strong><br>${App.escapeHtml(saboteur ? state.private.saboteurGoal : state.private.mission)}</div>
    ${state.private.partners.length ? `<p>你的搞事同伴：<strong>${state.private.partners.map(App.escapeHtml).join('、')}</strong></p>` : ''}
    <div id="timer" class="timer"></div><p class="subtitle">記住後把手機收好，不要讓別人看到。</p></section>`;
}

function intelBlock() {
  if (!['INTEL', 'DISCUSSION', 'VOTE', 'REVOTE', 'RESULT', 'CHECK_COMPANY'].includes(state.phase)) return '';
  return `<section class="card secret"><div class="eyebrow">本回合私人情報</div><div class="intel">${App.escapeHtml(state.private.intel || '本回合沒有額外情報。')}</div><p class="subtitle">系統情報 100% 真實；你可以隱瞞、只說一部分，或自己說謊。</p></section>`;
}

function resultHtml() {
  const result = state.result;
  if (!result) return '<section class="card notice">正在結算…</section>';
  const choice = state.event.options.find((item) => item.id === result.resolvedOptionId);
  return `<section class="card"><div class="eyebrow">投票結果</div><h2>${result.resolvedOptionId}｜${App.escapeHtml(choice.title)}</h2>
    ${result.initialVoteResult ? `<p class="notice">首次投票平手，已完成 10 秒快速重投。</p>` : ''}
    <div class="result-grid">${['A', 'B', 'C'].map((id) => `<div class="vote-count ${id === result.resolvedOptionId ? 'winner' : ''}"><span>${id}</span><strong>${result.voteCounts[id]}</strong></div>`).join('')}</div>
    <p class="subtitle">棄權 ${result.abstainCount} 人${result.tiedOptionIds.length > 1 ? `；快速重投仍平票，隨機選出 ${result.resolvedOptionId}` : ''}</p>
    ${result.conditionalApplied ? `<div class="intel"><strong>條件效果觸發</strong><br>${App.escapeHtml(result.conditionalDescription)}</div>` : ''}</section>`;
}

function finalHtml() {
  const mine = state.finalResults.find((result) => result.playerId === state.playerId);
  return `<section class="card final-card ${mine.win ? 'win' : 'lose'} role"><span class="tag ${mine.win ? 'win' : 'lose'}">${mine.win ? 'WIN' : 'LOSE'}</span><h2>${mine.win ? '你達成了目標' : '這次沒有成功'}</h2><p><strong>${App.escapeHtml(mine.mission)}</strong></p><p class="subtitle">${App.escapeHtml(mine.actual)}</p></section>
    <section class="card"><h3>最終揭露</h3>${state.finalResults.map((result) => `<div class="player"><span>${App.escapeHtml(result.name)}${result.role === 'SABOTEUR' ? '／搞事仔' : ''}</span><span class="tag ${result.win ? 'win' : 'lose'}">${result.win ? 'WIN' : 'LOSE'}</span></div>`).join('')}</section><p class="notice">等待 Host 決定是否再玩一場。</p>`;
}

function phaseHtml() {
  if (state.phase === 'LOBBY') return lobbyHtml();
  if (state.phase === 'ROLE') return roleHtml();
  if (state.phase === 'ROUND_START') return `<section class="card role"><div class="eyebrow">回到會議室</div><h2 class="title">Round ${state.round} / 8</h2><div id="timer" class="timer"></div></section>${secretSummary()}`;
  if (state.phase === 'EVENT') return `<section class="card">${App.eventHtml(state.event)}<div id="timer" class="timer"></div></section>${secretSummary()}`;
  if (state.phase === 'INTEL') return `${intelBlock()}<section class="card">${App.eventHtml(state.event)}<div id="timer" class="timer"></div></section>${secretSummary()}`;
  if (state.phase === 'DISCUSSION') return `${intelBlock()}<section class="card"><div class="eyebrow">自由討論</div><div class="intel"><strong>不限時間，由玩家自行控場</strong><br>討論完成後，請 Host 開始投票。</div>${App.eventHtml(state.event)}</section>${secretSummary()}`;
  if (state.phase === 'VOTE') return `${intelBlock()}<section class="card"><div class="eyebrow">匿名投票</div><h2>做出你的決定</h2>${state.private.hasVoted ? `<div class="notice">你已投給 ${state.private.selectedOptionId}，等待其他玩家。</div>` : ''}${App.eventHtml(state.event, true, state.private.selectedOptionId, state.private.hasVoted)}<div id="timer" class="timer"></div></section>${secretSummary()}`;
  if (state.phase === 'REVOTE') return `${intelBlock()}<section class="card"><div class="eyebrow">10 秒快速重投</div><h2>只選並列方案</h2><p class="subtitle">可選 ${state.allowedVoteOptionIds.join('、')}；若再次平票，系統將隨機決定。</p>${state.private.hasVoted ? `<div class="notice">你已投給 ${state.private.selectedOptionId}，等待重投結算。</div>` : ''}${App.eventHtml(state.event, true, state.private.selectedOptionId, state.private.hasVoted, state.allowedVoteOptionIds)}<div id="timer" class="timer"></div></section>${secretSummary()}`;
  if (state.phase === 'RESULT' || state.phase === 'CHECK_COMPANY') return `${resultHtml()}${secretSummary()}`;
  if (state.phase === 'NEXT_ROUND') return `<section class="card role"><h2>公司暫時活下來了</h2><p class="subtitle">下一輪的問題正在排隊。</p><div id="timer" class="timer"></div></section>${secretSummary()}`;
  if (state.phase === 'FINAL' || state.phase === 'GAME_OVER') return finalHtml();
  return '<section class="card notice">同步中…</section>';
}

function render() {
  renderStatus();
  app.innerHTML = phaseHtml();
  app.querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => vote(button.dataset.option, button)));
  updateTimer();
}

async function vote(optionId, button) {
  if (busy || state.private.hasVoted) return;
  if (!confirm(`確定投給 ${optionId}？送出後不能更改。`)) return;
  busy = true;
  app.querySelectorAll('[data-option]').forEach((item) => { item.disabled = true; });
  button.classList.add('selected');
  try {
    await App.api(`/api/rooms/${roomCode}/action`, { method: 'POST', body: { action: 'VOTE', optionId, token: playerToken, expectedPhaseVersion: state.phaseVersion } });
  } catch (error) {
    alert(error.message);
    app.querySelectorAll('[data-option]').forEach((item) => { item.disabled = false; });
  } finally { busy = false; }
}

function updateTimer() {
  const timer = document.querySelector('#timer');
  if (timer && state) timer.textContent = App.formatTimer(App.remaining(state));
}
setInterval(updateTimer, 250);
