'use strict';

const roomCode = App.roomFromUrl();
const hostToken = localStorage.getItem(`hostToken:${roomCode}`);
const app = document.querySelector('#app');
const statusBar = document.querySelector('#status');
let state = null;
let busy = false;
let revealTimer = null;
let pollTimer = null;

if (!/^\d{4}$/.test(roomCode) || !hostToken) {
  app.innerHTML = '<section class="card"><h2>無法恢復 Host</h2><p class="subtitle">此瀏覽器沒有這個房間的 Host Token，請回首頁重新建立房間。</p><a class="btn" href="/">回首頁</a></section>';
} else {
  connect();
}

function connect() {
  const events = new EventSource(`/api/rooms/${roomCode}/events?token=${encodeURIComponent(hostToken)}`);
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
    || JSON.stringify(nextState.players) !== JSON.stringify(state.players);
  state = nextState;
  state.receivedAt = Date.now();
  if (changed) render();
}

async function pollState() {
  try {
    applyState(await App.api(`/api/rooms/${roomCode}/view?token=${encodeURIComponent(hostToken)}`));
  } catch (error) {
    if (/找不到房間/.test(error.message)) showDisbanded();
    else if (!state) app.innerHTML = `<section class="card error">${App.escapeHtml(error.message)}</section>`;
  }
}

function showDisbanded() {
  clearInterval(pollTimer);
  pollTimer = null;
  state = null;
  statusBar.classList.add('hidden');
  localStorage.removeItem(`hostToken:${roomCode}`);
  app.innerHTML = '<section class="card role"><div class="role-icon">🗑️</div><h2>遊戲已解散</h2><p class="subtitle">房間與進行中的資料已刪除，所有玩家都已退出。</p><a class="btn" href="/">回首頁</a></section>';
}

function disbandButtonHtml() {
  return '<button class="btn danger full disband-button" data-action="DISBAND">解散遊戲</button>';
}

function renderStatus() {
  statusBar.classList.remove('hidden');
  statusBar.innerHTML = `<div class="round-pill">${state.round ? `Round ${state.round}/8` : `房間 ${state.roomCode}`}</div>
    <div class="stats">${App.statsHtml(state.company)}</div><div class="header-actions"><a class="rules-link" href="/rules.html" target="_blank" rel="noopener">規則</a><div class="phase-pill">${App.phaseLabel(state.phase)}</div></div>`;
}

function playersHtml() {
  return `<div class="players">${state.players.map((player) => `<div class="player"><span><i class="dot ${player.connected ? 'online' : ''}"></i>${App.escapeHtml(player.name)}</span><small>${player.connected ? '在線' : '離線'}</small></div>`).join('')}</div>`;
}

function lobbyHtml() {
  return `<div class="host-grid"><section class="card">
      <div class="eyebrow">等待同事報到</div><h2 class="title">今晚，誰會把公司搞垮？</h2>
      <p class="subtitle">需要 4–10 人。遊戲開始後將鎖定本局玩家名單。</p>
      <div class="room-code">${state.roomCode}</div>
      <button class="btn" data-action="START" ${state.controls.canStart ? '' : 'disabled'}>${state.playerCount < 4 ? `還需要 ${4 - state.playerCount} 人` : `開始遊戲（${state.playerCount} 人）`}</button>
      ${disbandButtonHtml()}
    </section><aside class="card host-sidebar"><div id="qr" class="qr"></div><p class="notice">掃描加入，或輸入房號 <strong>${state.roomCode}</strong></p>${playersHtml()}</aside></div>`;
}

function resultHtml() {
  const result = state.result;
  if (!result) return '<section class="card notice">正在結算…</section>';
  const event = state.event;
  const choice = event.options.find((item) => item.id === result.resolvedOptionId);
  const delta = (stat) => result.statsAfter[stat] - result.statsBefore[stat];
  return `<section class="card"><div class="eyebrow">Round ${result.round} 決策結果</div><h2 class="title">${result.resolvedOptionId}｜${App.escapeHtml(choice.title)}</h2>
    ${result.tiedOptionIds.length > 1 ? `<p class="subtitle">最高票平票：${result.tiedOptionIds.join('／')}，系統隨機選出 ${result.resolvedOptionId}。</p>` : ''}
    <div class="result-grid">${['A', 'B', 'C'].map((id) => `<div class="vote-count ${id === result.resolvedOptionId ? 'winner' : ''}"><span>${id}</span><strong>${result.voteCounts[id]}</strong><small>票</small></div>`).join('')}</div>
    <p class="subtitle">棄權 ${result.abstainCount} 人</p>
    <div class="delta">${['money', 'morale', 'risk'].map((stat) => { const change = delta(stat); return `<div><small>${stat.toUpperCase()}</small><strong>${result.statsBefore[stat]} → ${result.statsAfter[stat]}</strong><br><span class="${change >= 0 ? 'positive' : 'negative'}">${change >= 0 ? '+' : ''}${change}</span></div>`; }).join('')}</div>
    ${result.conditionalApplied ? `<div class="intel"><strong>條件效果觸發</strong><br>${App.escapeHtml(result.conditionalDescription)}</div>` : ''}
  </section>`;
}

function finalHtml() {
  const died = state.phase === 'GAME_OVER';
  return `<section class="card"><div class="eyebrow">${died ? 'GAME OVER' : 'FINAL REPORT'}</div>
    <h2 class="title">${died ? '公司倒了。會議可以結束了。' : '公司活過了八回合！'}</h2>
    ${died ? `<p class="subtitle">${state.deathReasons.map(App.deathText).join('；')}</p>` : '<p class="subtitle">先公布普通玩家，搞事仔最後揭露。</p>'}
    <div id="reveal-list">${state.finalResults.map((result, index) => `<article class="card final-card ${result.win ? 'win' : 'lose'} hidden" data-reveal="${index}">
      <span class="tag ${result.win ? 'win' : 'lose'}">${result.win ? 'WIN' : 'LOSE'}</span>
      <h2>${App.escapeHtml(result.name)} ${result.role === 'SABOTEUR' ? '／搞事仔' : ''}</h2>
      <p><strong>${App.escapeHtml(result.mission)}</strong></p><p class="subtitle">${App.escapeHtml(result.actual)}</p>
    </article>`).join('')}</div>
    <button class="btn" data-action="RESTART">再玩一場</button>
  </section>`;
}

function phaseMainHtml() {
  if (state.phase === 'ROLE') return '<section class="card role"><div class="role-icon">📱</div><div class="eyebrow">秘密資料已發送</div><h2>請查看自己的手機</h2><p class="subtitle">不要讓旁邊的人看到你的身份與任務。</p><div id="timer" class="timer"></div></section>';
  if (state.phase === 'ROUND_START') return `<section class="card role"><div class="eyebrow">新的一輪會議</div><h2 class="title">Round ${state.round} / 8</h2><p class="subtitle">請各位把專業表情準備好。</p><div id="timer" class="timer"></div></section>`;
  if (['EVENT', 'INTEL', 'DISCUSSION'].includes(state.phase)) return `<section class="card">${App.eventHtml(state.event)}${state.phase === 'INTEL' ? '<div class="intel">私人情報已發送到部分玩家手機。系統情報永遠為真。</div>' : ''}${state.phase === 'DISCUSSION' ? '<h3>討論時間</h3>' : ''}<div id="timer" class="timer"></div></section>`;
  if (state.phase === 'VOTE') {
    const percent = state.voteProgress.total ? Math.round(state.voteProgress.submitted / state.voteProgress.total * 100) : 0;
    return `<section class="card role"><div class="eyebrow">匿名投票中</div><h2 class="title">已投票 ${state.voteProgress.submitted} / ${state.voteProgress.total}</h2><progress max="100" value="${percent}"></progress><div id="timer" class="timer"></div><p class="subtitle">大螢幕不會顯示即時票數或玩家選項。</p></section>`;
  }
  if (state.phase === 'RESULT' || state.phase === 'CHECK_COMPANY') return resultHtml();
  if (state.phase === 'NEXT_ROUND') return `<section class="card role"><div class="eyebrow">公司還活著</div><h2 class="title">準備 Round ${state.round + 1}</h2><div id="timer" class="timer"></div></section>`;
  if (state.phase === 'FINAL' || state.phase === 'GAME_OVER') return finalHtml();
  return '<section class="card notice">同步狀態中…</section>';
}

function advanceLabel() {
  if (state.phase === 'DISCUSSION') return '提前結束討論';
  if (state.phase === 'VOTE') return '強制結束投票';
  return '強制進入下一階段';
}

function render() {
  clearTimeout(revealTimer);
  renderStatus();
  if (state.phase === 'LOBBY') {
    app.innerHTML = lobbyHtml();
    QR.render(document.querySelector('#qr'), `${location.origin}/play.html?room=${roomCode}`);
  } else {
    app.innerHTML = `<div class="host-grid"><div>${phaseMainHtml()}</div><aside class="card host-sidebar"><div class="eyebrow">房間 ${state.roomCode}</div><h3>${state.playerCount} 名玩家</h3>${playersHtml()}
      ${state.controls?.canAdvance ? `<button class="btn secondary full" data-action="ADVANCE">${advanceLabel()}</button>` : ''}</aside></div>`;
    const sidebar = app.querySelector('.host-sidebar');
    if (sidebar && !sidebar.querySelector('[data-action="DISBAND"]')) sidebar.insertAdjacentHTML('beforeend', disbandButtonHtml());
  }
  app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => perform(button.dataset.action, button)));
  if (['FINAL', 'GAME_OVER'].includes(state.phase)) revealNext(0);
  updateTimer();
}

function revealNext(index) {
  const item = document.querySelector(`[data-reveal="${index}"]`);
  if (!item) return;
  item.classList.remove('hidden');
  revealTimer = setTimeout(() => revealNext(index + 1), 1400);
}

async function perform(action, button) {
  if (busy) return;
  if (action === 'ADVANCE' && state.phase === 'VOTE' && !confirm('確定強制結束投票？未投票者將視為棄權。')) return;
  if (action === 'DISBAND' && !confirm('確定解散遊戲？房間、角色、投票與進度都會永久刪除，所有玩家將立即退出。')) return;
  busy = true;
  button.disabled = true;
  try {
    const result = await App.api(`/api/rooms/${roomCode}/action`, { method: 'POST', body: { action, token: hostToken, expectedPhaseVersion: state.phaseVersion } });
    if (result.disbanded) showDisbanded();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  } finally { busy = false; }
}

function updateTimer() {
  const timer = document.querySelector('#timer');
  if (timer && state) timer.textContent = App.formatTimer(App.remaining(state));
}
setInterval(updateTimer, 250);
