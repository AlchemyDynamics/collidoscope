/* ============================================================
   COLLIDOSCOPE — Game Controller
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- state ---------------- */
  const TOTAL_SPECIES = Object.keys(PARTICLES).length;
  const SAVE_KEY = 'collidoscope-save-v1';

  const state = {
    discovered: new Set(),
    seenCounts: {},
    collisions: 0,
    score: 0,
    achievements: new Set(),
    higgsCandidates: 0,
    higgsDryFires: 0,
    higgsConfirmed: false,
  };

  let currentEvent = null;
  let firing = false;
  let no3D = false;   // WebGL unavailable (Lockdown Mode, old GPU…) — game stays playable
  let settings = { sqrtS: 1, lumi: 0.5, bField: 3.8 };

  /* ---------------- dom ---------------- */
  const $ = id => document.getElementById(id);
  const fireBtn = $('btn-fire');
  const hudStatus = $('hud-status');

  /* ---------------- save / load ---------------- */
  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      discovered: [...state.discovered],
      seenCounts: state.seenCounts,
      collisions: state.collisions,
      score: state.score,
      achievements: [...state.achievements],
      higgsCandidates: state.higgsCandidates,
      higgsDryFires: state.higgsDryFires,
      higgsConfirmed: state.higgsConfirmed,
    }));
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return;
      state.discovered = new Set(d.discovered || []);
      state.seenCounts = d.seenCounts || {};
      state.collisions = d.collisions || 0;
      state.score = d.score || 0;
      state.achievements = new Set(d.achievements || []);
      state.higgsCandidates = d.higgsCandidates || 0;
      state.higgsDryFires = d.higgsDryFires || 0;
      state.higgsConfirmed = !!d.higgsConfirmed;
    } catch (e) { /* fresh start */ }
  }

  /* ---------------- splash ---------------- */
  const SPLASH_FACTS = [
    'The LHC\'s 27 km ring is so precise it must correct for the Moon\'s gravity stretching the ground.',
    'Protons in the LHC make 11,245 laps of the ring every second.',
    'The LHC\'s magnets are colder than outer space: −271.3 °C.',
    'CERN\'s detectors take 40 million pictures of collisions every second.',
    'The Higgs boson appears in roughly 1 of every 10 billion collisions.',
    'The World Wide Web was invented at CERN in 1989 — to share particle physics data!',
  ];

  function initSplash() {
    $('splash-fact').textContent = '💡 ' + SPLASH_FACTS[Math.floor(Math.random() * SPLASH_FACTS.length)];
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch) {
      $('viewport-hint').innerHTML = '👆 drag to rotate · pinch to zoom · tap the <b>?</b> markers to identify particles!';
    }
    $('splash-start').addEventListener('click', () => {
      SFX.unlock();
      SFX.click();
      $('splash').classList.add('fading');
      setTimeout(() => $('splash').remove(), 1300);
      if (!localStorage.getItem(SAVE_KEY)) openModal('modal-help');
      const standalone = window.navigator.standalone === true
        || window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: fullscreen)').matches;
      if (touch && window.matchMedia('(orientation: portrait)').matches) {
        setTimeout(() => toast('📱 <b>Tip:</b> rotate to landscape for the full control room <small>(check rotation lock if it won\'t turn)</small>'), 1600);
      }
      if (touch && !standalone) {
        setTimeout(() => toast('⛶ <b>Go fullscreen:</b> tap Share, then <b>Add to Home Screen</b> <small>launches the game without browser bars</small>', true), 6200);
      }
    });
  }

  /* ---------------- sliders ---------------- */
  // log-scale energy: slider 0..1000 → 0.3 GeV .. 13600 GeV
  const E_MIN = 0.3, E_MAX = 13600;
  function sliderToEnergy(v) {
    return E_MIN * Math.pow(E_MAX / E_MIN, v / 1000);
  }
  function fmtEnergy(gev) {
    if (gev >= 1000) return (gev / 1000).toFixed(gev >= 10000 ? 1 : 2) + ' TeV';
    if (gev >= 10) return Math.round(gev) + ' GeV';
    return gev.toFixed(1) + ' GeV';
  }

  function updateEra() {
    const era = MACHINE_ERAS.find(e => settings.sqrtS <= e.maxGeV) || MACHINE_ERAS[MACHINE_ERAS.length - 1];
    $('era-name').textContent = era.name;
    $('era-sub').textContent = era.sub;
    $('era-name').parentElement.classList.toggle('lhc', era.name.startsWith('LHC'));
  }

  function initSliders() {
    const slE = $('sl-energy'), slL = $('sl-lumi'), slB = $('sl-bfield');
    const sync = () => {
      settings.sqrtS = sliderToEnergy(+slE.value);
      settings.lumi = +slL.value / 100;
      settings.bField = +slB.value / 10;
      $('val-energy').textContent = fmtEnergy(settings.sqrtS);
      $('val-lumi').textContent = Math.round(settings.lumi * 100) + '%';
      $('val-bfield').textContent = settings.bField.toFixed(1) + ' T';
      updateEra();
    };
    [slE, slL, slB].forEach(s => s.addEventListener('input', sync));
    sync();
  }

  /* ---------------- fire sequence ---------------- */
  let collisionPending = false;

  function fire() {
    if (firing) return;
    firing = true;
    collisionPending = true;
    fireBtn.disabled = true;
    fireBtn.classList.add('charging');
    fireBtn.querySelector('.fire-label').textContent = '⚡ CHARGING…';
    hudStatus.textContent = 'ACCELERATING BEAMS';
    hudStatus.classList.add('busy');
    $('viewport-hint').classList.add('faded');

    try { Detector3D.clearEvent(); } catch (e) { /* 3D optional */ }
    SFX.charge(2.1);
    try { Detector3D.playBeams(2.2, onCollide); } catch (e) { /* watchdog covers it */ }
    // watchdog: the collision must land even if the 3D beam animation stalls
    setTimeout(onCollide, 2700);
  }

  function onCollide() {
    if (!collisionPending) return;
    collisionPending = false;
    SFX.boom();
    state.collisions++;
    unlock('firstfire');

    currentEvent = Physics.buildEvent(settings, state);

    // Higgs pity counter
    const prereqs = ['wboson', 'zboson', 'top'].every(id => state.discovered.has(id));
    if (prereqs && !state.higgsConfirmed && settings.sqrtS >= 5000) {
      state.higgsDryFires = currentEvent.higgsEvent ? 0 : (state.higgsDryFires + 1);
    }

    setTimeout(() => {
      try { Detector3D.renderEvent(currentEvent, settings.bField); } catch (e) { /* report still lands */ }
      reportEvent(currentEvent);
      hudStatus.textContent = 'EVENT RECORDED — CLICK ? TO IDENTIFY';
      hudStatus.classList.remove('busy');
      fireBtn.disabled = false;
      fireBtn.classList.remove('charging');
      fireBtn.querySelector('.fire-label').textContent = '🔥 FIRE';
      firing = false;
      refreshStats();
      save();
    }, 350);
  }

  function reportEvent(ev) {
    const n = ev.particles.length;
    const unknown = ev.particles.filter(p => !state.discovered.has(p.species)).length;
    let html = `<span class="rep-line">💥 Collision #${state.collisions} at <b>√s = ${fmtEnergy(ev.sqrtS)}</b></span>`;
    html += `<span class="rep-line">${n} particles detected — ${unknown > 0 ? `<b>${unknown} unidentified!</b>` : 'all species known'}</span>`;
    if (ev.higgsEvent) {
      html += `<span class="rep-line rep-hot">⚠️ ANOMALY: excess photon pair near 125 GeV…</span>`;
    } else if (ev.featuredIds.length) {
      const names = ev.featuredIds.map(id => PARTICLES[id].rarity).join('');
      if (ev.featuredIds.some(id => ['rare', 'epic'].includes(PARTICLES[id].rarity))) {
        html += `<span class="rep-line rep-hot">📡 Unusual signature in the data — investigate!</span>`;
      }
    }
    if (no3D) {
      html += `<span class="rep-line"><em>Tap each ? to identify the particle:</em></span>`;
      html += `<span class="rep-chips">` + ev.particles.map((p, i) =>
        `<button class="chip" data-pidx="${i}" style="border-color:${PARTICLES[p.species].color}">?</button>`
      ).join('') + `</span>`;
    } else {
      html += `<span class="rep-line"><em>Rotate the detector and click every ? marker.</em></span>`;
    }
    $('event-report').innerHTML = html;
  }

  /* ---------------- discovery ---------------- */
  function onParticleClicked(idx, marker) {
    if (!currentEvent) return;
    const p = currentEvent.particles[idx];
    if (!p || p._logged) { if (p) flashSeen(p); return; }
    p._logged = true;

    const sp = PARTICLES[p.species];
    SFX.scan();
    if (marker) { try { Detector3D.resolveMarker(marker, sp.symbol.replace(/[⁺⁻⁰±]/g, ''), sp.color); } catch (e) {} }

    state.seenCounts[p.species] = (state.seenCounts[p.species] || 0) + 1;

    const isNew = !state.discovered.has(p.species);

    if (p.species === 'higgs' && !state.higgsConfirmed) {
      handleHiggsCandidate();
      return;
    }

    if (isNew) {
      state.discovered.add(p.species);
      const pts = RARITY[sp.rarity].pts;
      state.score += pts;
      setTimeout(() => showDiscovery(sp, pts), 250);
      SFX.discover(sp.rarity === 'epic' ? 2 : sp.rarity === 'rare' ? 1 : 0);
      confettiBurst(sp.rarity === 'epic' ? 140 : 60, sp.color);
      checkAchievements(sp);
    } else {
      state.score += 1;
      toast(`<b>${sp.name}</b> identified <small>seen ×${state.seenCounts[p.species]} · +1 point</small>`);
      SFX.click();
    }
    refreshStats();
    renderDex();
    save();
  }

  function flashSeen(p) {
    const sp = PARTICLES[p.species];
    toast(`<b>${sp.name}</b> — already logged this event`);
  }

  /* ---------------- the Higgs: a 5-sigma journey ---------------- */
  function handleHiggsCandidate() {
    state.higgsCandidates = Math.min(4, state.higgsCandidates + 1);
    // (seenCounts.higgs already incremented by onParticleClicked)
    unlock('candidate');
    SFX.discover(2);
    confettiBurst(120, '#fde047');

    const sigma = candidatesToSigma(state.higgsCandidates);
    updateHiggsPanel();

    if (state.higgsCandidates >= 4) {
      // FIVE SIGMA — official discovery!
      state.higgsConfirmed = true;
      state.discovered.add('higgs');
      state.score += RARITY.legendary.pts;
      unlock('higgs');
      SFX.legendary();
      confettiRain(6000);
      setTimeout(() => showDiscovery(PARTICLES.higgs, RARITY.legendary.pts, true), 600);
      checkAchievements(PARTICLES.higgs);
    } else {
      toast(`<b>✨ HIGGS CANDIDATE #${state.higgsCandidates}!</b><small>Two photons at 125 GeV… significance now ${sigma}σ. Not proof yet — keep colliding!</small>`, true);
    }
    refreshStats();
    renderDex();
    save();
  }

  function candidatesToSigma(n) {
    return [0, 1.8, 3.1, 4.2, 5.0][Math.min(4, n)].toFixed(1);
  }

  function updateHiggsPanel() {
    const prereqs = ['wboson', 'zboson', 'top'].every(id => state.discovered.has(id));
    const panel = $('higgs-hunt');
    if (!prereqs || state.higgsConfirmed) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const sigma = candidatesToSigma(state.higgsCandidates);
    $('sigma-fill').style.width = (state.higgsCandidates / 4 * 100) + '%';
    $('sigma-label').textContent = `${sigma}σ — ${state.higgsCandidates}/4 candidates`;
    $('higgs-tip').textContent = state.higgsCandidates === 0
      ? 'Run ≥ 5 TeV at high intensity. Watch for twin photons at 125 GeV…'
      : 'The data is whispering. CERN needed 5σ — a 1-in-3.5-million fluke chance. So do you.';
  }

  /* ---------------- discovery modal ---------------- */
  function showDiscovery(sp, pts, legendary = false) {
    const card = $('discovery-card');
    card.classList.toggle('legendary-card', legendary);
    $('disco-banner').textContent = legendary ? '👑 5σ — OFFICIAL DISCOVERY! 👑' : 'NEW DISCOVERY!';
    $('disco-symbol').textContent = sp.symbol;
    $('disco-symbol').style.color = sp.color;
    $('disco-name').textContent = sp.name;
    const r = RARITY[sp.rarity];
    $('disco-rarity').textContent = r.label;
    $('disco-rarity').style.color = r.color;
    $('disco-tagline').textContent = '“' + sp.tagline + '”';
    $('disco-stats').innerHTML = `
      <div><b>${sp.mass.split(' ')[0]}</b><label>${sp.mass.includes('MeV') ? 'MeV/c²' : sp.mass.includes('GeV') ? 'GeV/c²' : 'mass'}</label></div>
      <div><b>${sp.charge}</b><label>charge</label></div>
      <div><b>${sp.spin}</b><label>spin</label></div>
      <div><b>${sp.type.split(' ')[0]}</b><label>family</label></div>`;
    $('disco-fact').innerHTML = '🌟 ' + sp.funFact;
    $('disco-how').innerHTML = '🔬 <b>How physicists catch it:</b> ' + sp.howWeSeeIt + (sp.decayNote ? `<br>⚛️ <b>Decay:</b> ${sp.decayNote}` : '');
    $('disco-history').textContent = '📜 First discovered: ' + sp.discovered;
    $('disco-points').textContent = `+${pts} Science Points`;
    openModal('modal-discovery');
  }

  /* ---------------- particle-dex ---------------- */
  let dexFilter = 'all';

  function matchesFilter(sp) {
    if (dexFilter === 'all') return true;
    if (dexFilter === 'Hadron') return /Baryon|Meson/.test(sp.type);
    return sp.type.includes(dexFilter);
  }

  function renderDex() {
    const grid = $('dex-grid');
    grid.innerHTML = '';
    Object.values(PARTICLES).filter(matchesFilter).forEach(sp => {
      const got = state.discovered.has(sp.id);
      const card = document.createElement('div');
      card.className = 'dex-card ' + (got ? 'discovered' : 'locked') +
        (got && sp.rarity === 'legendary' ? ' legendary' : '');
      const r = RARITY[sp.rarity];
      card.innerHTML = `
        <span class="rarity-pip" style="background:${r.color}"></span>
        <div class="sym" style="color:${got ? sp.color : '#475569'}">${got ? sp.symbol : '?'}</div>
        <div class="nm">${got ? sp.name : '???'}</div>
        <div class="seen">${got ? '×' + (state.seenCounts[sp.id] || 1) : r.label}</div>`;
      if (got) card.addEventListener('click', () => { SFX.click(); showProfile(sp); });
      grid.appendChild(card);
    });
    $('dex-count').textContent = `${state.discovered.size}/${TOTAL_SPECIES}`;
  }

  function showProfile(sp) {
    const r = RARITY[sp.rarity];
    $('profile-card').innerHTML = `
      <div class="disco-symbol" style="color:${sp.color}">${sp.symbol}</div>
      <h2 style="font-family:var(--font-display);margin:6px 0 4px">${sp.name}</h2>
      <div class="disco-rarity" style="color:${r.color}">${r.label} · seen ×${state.seenCounts[sp.id] || 1}</div>
      <p class="disco-tagline">“${sp.tagline}”</p>
      <div class="disco-stats">
        <div><b>${sp.mass.split(' ')[0]}</b><label>${sp.mass.includes('MeV') ? 'MeV/c²' : sp.mass.includes('GeV') ? 'GeV/c²' : 'mass'}</label></div>
        <div><b>${sp.charge}</b><label>charge</label></div>
        <div><b>${sp.spin}</b><label>spin</label></div>
        <div><b>${sp.lifetime.length > 12 ? sp.lifetime.split(' ')[0] : sp.lifetime}</b><label>lifetime</label></div>
      </div>
      <p style="text-align:left;font-size:0.85rem;color:var(--text-dim);margin-bottom:10px"><b style="color:var(--text)">Type:</b> ${sp.type}</p>
      <p class="disco-fact">🌟 ${sp.funFact}</p>
      <p class="disco-how">🔬 <b>How physicists catch it:</b> ${sp.howWeSeeIt}${sp.decayNote ? `<br>⚛️ <b>Decay:</b> ${sp.decayNote}` : ''}</p>
      <p class="disco-history">📜 First discovered: ${sp.discovered}</p>
      <button class="btn-close-modal" data-close>CLOSE</button>`;
    openModal('modal-profile');
  }

  /* ---------------- achievements ---------------- */
  function unlock(id) {
    if (state.achievements.has(id)) return;
    state.achievements.add(id);
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) {
      toast(`${a.icon} <b>ACHIEVEMENT: ${a.name}</b><small>${a.desc}</small>`, true);
      SFX.achievement();
      state.score += 50;
    }
    save();
  }

  const STRANGE_SET = ['kplus', 'kzero', 'lambda', 'sigma', 'xi', 'omega'];

  function checkAchievements(justFound) {
    const d = state.discovered;
    if (d.size >= 1) unlock('firstdisco');
    if (d.size >= 5) unlock('five');
    if (d.size >= 15) unlock('fifteen');
    if (['positron', 'antiproton'].some(id => d.has(id))) unlock('antimatter');
    if (d.has('neutrino')) unlock('ghost');
    if (STRANGE_SET.filter(id => d.has(id)).length >= 3) unlock('strange');
    if (d.has('jpsi')) unlock('november');
    if (['up', 'down', 'strange', 'charm', 'bottom', 'gluon'].some(id => d.has(id))) unlock('jetset');
    if (d.has('omega')) unlock('omega');
    if (d.has('wboson') && d.has('zboson')) unlock('forcecarrier');
    if (d.has('top')) unlock('heavyweight');
    if (d.size >= TOTAL_SPECIES) unlock('all');
    updateHiggsPanel();
    if (['wboson', 'zboson', 'top'].includes(justFound.id)) {
      const prereqs = ['wboson', 'zboson', 'top'].every(id => d.has(id));
      if (prereqs && !state.higgsConfirmed) {
        setTimeout(() => toast(`👑 <b>THE HIGGS HUNT BEGINS</b><small>You've mastered the heavy bosons. Push past 5 TeV at full intensity and hunt the God Particle…</small>`, true), 1500);
      }
    }
  }

  function renderTrophies() {
    $('trophy-list').innerHTML = ACHIEVEMENTS.map(a => {
      const got = state.achievements.has(a.id);
      return `<div class="trophy ${got ? 'unlocked' : 'locked'}">
        <div class="t-icon">${a.icon}</div>
        <div><div class="t-name">${got ? a.name : '???'}</div><div class="t-desc">${a.desc}</div></div>
      </div>`;
    }).join('');
  }

  /* ---------------- stats / toasts / modals ---------------- */
  function refreshStats() {
    $('stat-collisions').textContent = state.collisions;
    $('stat-discovered').textContent = `${state.discovered.size}/${TOTAL_SPECIES}`;
    $('stat-score').textContent = state.score.toLocaleString();
    updateHiggsPanel();
    updateDexToggle();
  }

  // collapsed dex bar still shows the discovery count
  function updateDexToggle() {
    $('dex-toggle').textContent = $('layout').classList.contains('dex-collapsed')
      ? `◀ ${state.discovered.size}/${TOTAL_SPECIES}`
      : '▶';
  }

  function toast(html, gold = false) {
    const wrap = $('toasts');
    // phones: cap the stack so notifications never wall off the detector
    const cap = window.matchMedia('(pointer: coarse)').matches ? 2 : 5;
    while (wrap.children.length >= cap) wrap.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (gold ? ' gold' : '');
    t.innerHTML = html;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 4400);
  }

  function openModal(id) { $(id).classList.remove('hidden'); }
  function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }

  /* ---------------- confetti ---------------- */
  const confettiCanvas = $('confetti');
  const cctx = confettiCanvas.getContext('2d');
  let confetti = [];

  function sizeConfetti() {
    confettiCanvas.width = innerWidth;
    confettiCanvas.height = innerHeight;
  }

  function confettiBurst(n, color) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9;
      confetti.push({
        x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
        size: 3 + Math.random() * 5, life: 1,
        color: Math.random() < 0.6 ? color : ['#22d3ee', '#e879f9', '#fde047', '#4ade80'][Math.floor(Math.random() * 4)],
        spin: Math.random() * 6,
      });
    }
  }

  function confettiRain(duration) {
    const end = performance.now() + duration;
    (function drop() {
      for (let i = 0; i < 7; i++) {
        confetti.push({
          x: Math.random() * innerWidth, y: -10,
          vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4,
          size: 4 + Math.random() * 6, life: 1,
          color: ['#fde047', '#fbbf24', '#22d3ee', '#e879f9', '#fff'][Math.floor(Math.random() * 5)],
          spin: Math.random() * 6,
        });
      }
      if (performance.now() < end) setTimeout(drop, 60);
    })();
  }

  function confettiLoop() {
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confetti = confetti.filter(c => c.life > 0 && c.y < innerHeight + 20);
    for (const c of confetti) {
      c.x += c.vx; c.y += c.vy; c.vy += 0.12; c.life -= 0.006; c.spin += 0.1;
      cctx.save();
      cctx.globalAlpha = Math.max(0, c.life);
      cctx.translate(c.x, c.y);
      cctx.rotate(c.spin);
      cctx.fillStyle = c.color;
      cctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
      cctx.restore();
    }
    requestAnimationFrame(confettiLoop);
  }

  /* ---------------- wire up ---------------- */
  function initUI() {
    fireBtn.addEventListener('click', fire);

    $('btn-help').addEventListener('click', () => { SFX.click(); openModal('modal-help'); });
    $('btn-trophies').addEventListener('click', () => { SFX.click(); renderTrophies(); openModal('modal-trophies'); });
    $('btn-mute').addEventListener('click', () => {
      SFX.setMuted(!SFX.isMuted());
      $('btn-mute').textContent = SFX.isMuted() ? '🔇' : '🔊';
    });
    $('btn-cam-reset').addEventListener('click', () => { try { Detector3D.resetCamera(); } catch (e) {} });
    $('disco-close').addEventListener('click', () => { SFX.click(); closeModals(); });

    // detector fullscreen: CSS takeover, camera untouched so the view persists
    $('btn-fs').addEventListener('click', () => {
      SFX.click();
      const on = document.body.classList.toggle('detector-fs');
      $('btn-fs').textContent = on ? '✕' : '⛶';
      $('btn-fs').title = on ? 'Exit fullscreen' : 'Fullscreen detector';
    });

    // particle-dex minimize (landscape cockpit)
    let dexCollapsed = localStorage.getItem('collidoscope_dex_min') === '1';
    const applyDex = () => {
      $('layout').classList.toggle('dex-collapsed', dexCollapsed);
      updateDexToggle();
    };
    $('dex-toggle').addEventListener('click', () => {
      SFX.click();
      dexCollapsed = !dexCollapsed;
      localStorage.setItem('collidoscope_dex_min', dexCollapsed ? '1' : '0');
      applyDex();
    });
    applyDex();

    document.addEventListener('click', e => {
      if (e.target.matches('[data-close]')) { SFX.click(); closeModals(); }
      if (e.target.classList.contains('modal')) closeModals();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (document.body.classList.contains('detector-fs')) {
          document.body.classList.remove('detector-fs');
          $('btn-fs').textContent = '⛶';
          $('btn-fs').title = 'Fullscreen detector';
        }
        closeModals();
      }
      if (e.key === ' ' && !firing && document.activeElement.tagName !== 'INPUT' &&
          ![...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'))) {
        e.preventDefault(); fire();
      }
    });

    // no-3D fallback: identify particles from chips in the event report
    $('event-report').addEventListener('click', e => {
      const b = e.target.closest('[data-pidx]');
      if (!b || b.disabled || !currentEvent) return;
      const idx = +b.dataset.pidx;
      onParticleClicked(idx, null);
      const p = currentEvent.particles[idx];
      if (p) {
        const sp = PARTICLES[p.species];
        b.textContent = sp.symbol;
        b.style.color = sp.color;
        b.disabled = true;
      }
    });

    document.querySelectorAll('.dex-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dex-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        dexFilter = tab.dataset.filter;
        renderDex();
      });
    });

    window.addEventListener('resize', sizeConfetti);
  }

  /* ---------------- boot ---------------- */
  load();
  initSplash();
  initSliders();
  initUI();
  sizeConfetti();
  confettiLoop();
  try {
    Detector3D.init($('scene3d'));
    Detector3D.onParticleClick(onParticleClicked);
  } catch (e) {
    no3D = true;
    hudStatus.textContent = '⚠️ 2D MODE — IDENTIFY PARTICLES IN THE EVENT REPORT';
    $('viewport-hint').classList.add('faded');
    document.getElementById('viewport').insertAdjacentHTML('beforeend', `
      <div class="webgl-fallback">
        <h3>🔭 3D detector view unavailable</h3>
        <p>This browser has <b>WebGL turned off</b>, so the 3D event display can't draw.
        <b>The game still works</b> — fire the beams and identify particles right in the
        Control Room's event report.</p>
        <p class="wf-fix"><b>To get the full 3D view in Safari:</b></p>
        <ul>
          <li>If <b>Lockdown Mode</b> is on: click the page-settings (<b>aA</b> or puzzle) icon
              in the address bar → <i>Website Settings</i> → turn Lockdown Mode <b>off for this
              website only</b> — your passwords and other sites are not affected.</li>
          <li>Older Safari: <i>Safari → Settings → Websites → WebGL</i> → set this site to <b>Allow</b>.</li>
          <li>Or open this page in Chrome, Firefox, or Edge.</li>
        </ul>
        <p class="wf-tech">${(e && e.message ? e.message : 'WebGL error')} · ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '')}</p>
      </div>`);
  }
  refreshStats();
  renderDex();
  updateHiggsPanel();

  // surface unexpected errors so remote players can report them
  window.addEventListener('error', e => {
    toast(`⚠️ <b>Glitch in the detector</b><small>${e.message || 'unknown error'}</small>`);
  });
})();
