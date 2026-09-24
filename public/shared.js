'use strict';

window.App = (() => {
  const PHASES = {
    LOBBY: '等待加入', ROLE: '確認身份', ROUND_START: '回合開始', EVENT: '事件公開',
    INTEL: '私人情報', DISCUSSION: '自由討論', VOTE: '匿名投票', REVOTE: '10 秒快速重投', RESULT: '公布結果',
    CHECK_COMPANY: '公司健檢', NEXT_ROUND: '準備下一回合', FINAL: '最終結算', GAME_OVER: '公司倒閉',
  };
  const DEATHS = { BANKRUPT: '資金歸零，公司破產', MASS_RESIGNATION: '士氣歸零，員工集體離職', EXPLOSION: '風險爆表，公司爆炸' };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new Error(payload.error || '連線失敗');
    return payload;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function statsHtml(company) {
    return `<div class="stat money"><span>Money 資金</span><strong>${company.money}</strong></div>
      <div class="stat morale"><span>Morale 士氣</span><strong>${company.morale}</strong></div>
      <div class="stat risk"><span>Risk 風險</span><strong>${company.risk}</strong></div>`;
  }

  function effectsHtml(effects) {
    const labels = { money: 'Money', morale: 'Morale', risk: 'Risk' };
    return Object.entries(effects || {}).filter(([, value]) => value !== 0).map(([stat, value]) =>
      `<span class="effect">${labels[stat]} ${value > 0 ? '+' : ''}${value}</span>`).join('');
  }

  function eventHtml(event, vote = false, selected = null, disabled = false, allowedOptionIds = null) {
    if (!event) return '';
    return `<div class="eyebrow">${escapeHtml(event.stage)} EVENT</div><h2 class="title">${escapeHtml(event.title)}</h2>
      <p class="subtitle">${escapeHtml(event.description)}</p><div class="options">${event.options.map((option) => {
        const tag = vote ? 'button' : 'div';
        const optionDisabled = disabled || (allowedOptionIds && !allowedOptionIds.includes(option.id));
        return `<${tag} class="option ${vote ? 'vote' : ''} ${selected === option.id ? 'selected' : ''}" ${vote ? `data-option="${option.id}" ${optionDisabled ? 'disabled' : ''}` : ''}>
          <strong>${option.id}｜${escapeHtml(option.title)}</strong><p>${escapeHtml(option.description)}</p>
          <div class="effects">${effectsHtml(option.effects)}</div></${tag}>`;
      }).join('')}</div>`;
  }

  function showError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function phaseLabel(phase) { return PHASES[phase] || phase; }
  function deathText(reason) { return DEATHS[reason] || reason; }
  function roomFromUrl() { return new URLSearchParams(location.search).get('room') || ''; }
  function remaining(state) { return state.phaseEndsAt ? Math.max(0, Math.ceil((state.phaseEndsAt - (Date.now() + (state.serverNow - state.receivedAt))) / 1000)) : null; }
  function formatTimer(seconds) {
    if (seconds === null) return '—';
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  return { api, deathText, effectsHtml, escapeHtml, eventHtml, formatTimer, phaseLabel, remaining, roomFromUrl, showError, statsHtml };
})();
