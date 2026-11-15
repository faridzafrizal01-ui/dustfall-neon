// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money, bomb status,
// kill feed, progress bar, announcements, and the three overlays (start / pause /
// round end, and the buy menu). It never touches the simulation; main.js pushes
// numbers in and reads the play / deploy / buy callbacks out.
import { WEAPONS } from './weapons.js';
import { SMOKE_PRICE } from './state.js';

const COPY = {
  start: {
    title: 'NEONDOCK',
    copy: 'A night dockyard, two sites, four Raiders. Hold the sites, defuse the device, and make every shot count — or vanish in smoke and take them by surprise.',
    action: 'Click to play',
  },
  paused: {
    title: 'NEONDOCK',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const stats = $('overlay-stats');
  const play = $('play');
  const buyPanel = $('buy');
  const buyMoney = $('buy-money');
  const buyItems = $('buy-items');
  const buyTimer = $('buy-timer');
  const deploy = $('deploy');
  const healthNum = $('health-num');
  const healthFill = $('health-fill');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const grenadeCount = $('grenade-count');
  const smokeCount = $('smoke-count');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const roundValue = $('round-value');
  const bombText = $('bomb-text');
  const bombStatus = $('bomb-status');
  const killfeed = $('killfeed');
  const progress = $('progress');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const announceBox = $('announce');
  const announceTitle = $('announce-title');
  const announceSub = $('announce-sub');
  const damage = $('damage');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const ammoBox = $('ammo');

  let hitTimer = 0;
  let announceTimer = 0;
  let damageTimer = 0;
  let lastAmmo = '';
  let lastHealth = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastMoney = '';
  let lastBomb = '';

  function fmtTime(s) {
    const v = Math.max(0, Math.ceil(s));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthNum.textContent = String(v);
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
    },
    setAmmo(mag, reserve, label) {
      const key = `${mag}|${reserve}|${label}`;
      if (key === lastAmmo) return;
      lastAmmo = key;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = label;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setTimer(seconds, planted) {
      const key = `${fmtTime(seconds)}|${planted}`;
      if (key === lastTimer) return;
      lastTimer = key;
      timerValue.textContent = fmtTime(seconds);
      timerValue.classList.toggle('urgent', seconds <= 10);
    },
    setScore(us, them, round) {
      const key = `${us}|${them}|${round}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreValue.textContent = `${us} — ${them}`;
      roundValue.textContent = `ROUND ${round}`;
    },
    setMoney(money, grenades, smokes) {
      const key = `${money}|${grenades}|${smokes}`;
      if (key === lastMoney) return;
      lastMoney = key;
      moneyValue.textContent = `$${money}`;
      grenadeCount.textContent = `◉ ${grenades}`;
      smokeCount.textContent = `☁ ${smokes}`;
    },
    setBomb(text, kind) {
      const key = `${text}|${kind}`;
      if (key === lastBomb) return;
      lastBomb = key;
      bombText.textContent = text;
      bombStatus.className = kind ? `bomb-${kind}` : '';
      bombStatus.hidden = !text;
    },
    setCrosshair(spread) {
      // Spread in radians -> pixels of crosshair gap.
      const px = Math.round(4 + spread * 900);
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 5000);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 180);
    },
    announce(titleText, subText, holdMs = 2200) {
      announceTitle.textContent = titleText;
      announceSub.textContent = subText || '';
      announceBox.classList.add('on');
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => announceBox.classList.remove('on'), holdMs);
    },
    setProgress(label, frac) {
      if (label == null) {
        progress.hidden = true;
        return;
      }
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showOverlay(mode, data) {
      if (mode === 'roundEnd') {
        title.textContent = data.win ? 'SITE HELD' : 'SITE LOST';
        copy.textContent = data.reason;
        stats.textContent = `Earned $${data.earned}  ·  Balance $${data.money}  ·  Kills ${data.kills}`;
        play.textContent = 'Next round';
      } else {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        stats.textContent = '';
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(state, onBuy, onDeploy) {
      buyMoney.textContent = `$${state.money}`;
      buyItems.innerHTML = '';
      const card = (name, label, desc, price, owned, disabled, tag) => {
        const el = document.createElement('div');
        el.className = `buy-card${owned ? ' owned' : ''}${disabled ? ' disabled' : ''}`;
        el.innerHTML = `<b>${label}</b><span>${desc}</span><em>${tag}</em>`;
        if (!owned && !disabled) el.addEventListener('click', () => onBuy(name));
        buyItems.appendChild(el);
      };
      card('rifle', 'VK-47 rifle', '36 dmg · 4× head · 30 rounds · auto', WEAPONS.rifle.price, state.owned.rifle, state.money < WEAPONS.rifle.price, state.owned.rifle ? 'OWNED' : `$${WEAPONS.rifle.price}`);
      card('smg', 'Raptor-9 SMG', '26 dmg · 3× head · 32 rounds · fast', WEAPONS.smg.price, state.owned.smg, state.money < WEAPONS.smg.price, state.owned.smg ? 'OWNED' : `$${WEAPONS.smg.price}`);
      card('pistol', 'P9 sidearm', '34 dmg · 2× head · 12 rounds · free', 0, true, false, 'OWNED');
      const gDisabled = state.owned.grenades >= 2 || state.money < 300;
      card('grenade', 'Spark HE grenade', 'Area damage · throw with G', 300, false, gDisabled, state.owned.grenades >= 2 ? `MAX ×${state.owned.grenades}` : `$300 · ×${state.owned.grenades}`);
      const sDisabled = state.owned.smokes >= 2 || state.money < SMOKE_PRICE;
      card('smoke', 'Vapor smoke grenade', 'Blocks sight 12 s · throw with H', SMOKE_PRICE, false, sDisabled, state.owned.smokes >= 2 ? `MAX ×${state.owned.smokes}` : `$${SMOKE_PRICE} · ×${state.owned.smokes}`);
      buyPanel.hidden = false;
      deploy.onclick = onDeploy;
    },
    setBuyTimer(seconds) {
      buyTimer.textContent = `Deploy in ${Math.max(0, Math.ceil(seconds))}s — or press Deploy`;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
