/* ============================================================
   COLLIDOSCOPE — Sound Engine (pure WebAudio synthesis)
   ============================================================ */

const SFX = (() => {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(gain, t0, attack, peak, decay) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function tone(freq, type, attack, peak, decay, detune = 0, when = 0) {
    if (muted) return;
    const a = ac(), t0 = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    env(g, t0, attack, peak, decay);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + attack + decay + 0.1);
  }

  /* Rising power-up sweep during beam charge */
  function charge(duration = 2.2) {
    if (muted) return;
    const a = ac(), t0 = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t0);
    o.frequency.exponentialRampToValueAtTime(880, t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.3);
    g.gain.setValueAtTime(0.12, t0 + duration - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    const f = a.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(400, t0);
    f.frequency.exponentialRampToValueAtTime(4000, t0 + duration);
    o.connect(f).connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + duration + 0.1);
    // rising ticks like the RF cavities
    for (let i = 0; i < 14; i++) {
      tone(220 + i * 90, 'square', 0.005, 0.045, 0.06, 0, (duration / 14) * i);
    }
  }

  /* The collision boom — filtered noise burst + sub thump */
  function boom() {
    if (muted) return;
    const a = ac(), t0 = a.currentTime;
    const len = a.sampleRate * 0.8;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5500, t0);
    f.frequency.exponentialRampToValueAtTime(120, t0 + 0.7);
    const g = a.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t0);
    tone(60, 'sine', 0.005, 0.55, 0.5);   // sub thump
    tone(90, 'sine', 0.005, 0.3, 0.35);
  }

  function click() { tone(880, 'sine', 0.002, 0.08, 0.07); }

  function scan() {
    tone(520, 'sine', 0.01, 0.07, 0.12);
    tone(760, 'sine', 0.01, 0.07, 0.12, 0, 0.09);
  }

  /* Discovery fanfare — little arpeggio, bigger for rarer finds */
  function discover(tier = 0) {
    const base = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    base.forEach((f, i) => tone(f, 'triangle', 0.01, 0.16, 0.5, 0, i * 0.09));
    if (tier >= 2) [1318.5, 1568].forEach((f, i) => tone(f, 'triangle', 0.01, 0.14, 0.6, 0, 0.4 + i * 0.1));
  }

  /* The Higgs fanfare — full golden chord cascade */
  function legendary() {
    const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      tone(f, 'triangle', 0.02, 0.18, 1.4, 0, i * 0.13);
      tone(f * 2, 'sine', 0.02, 0.07, 1.2, 5, i * 0.13);
    });
    tone(65.4, 'sine', 0.05, 0.3, 2.2, 0, 0.4); // deep C pedal
  }

  function achievement() {
    [659.25, 880, 1108.7].forEach((f, i) => tone(f, 'square', 0.005, 0.06, 0.25, 0, i * 0.08));
  }

  function setMuted(v) { muted = v; }
  function isMuted() { return muted; }

  return { charge, boom, click, scan, discover, legendary, achievement, setMuted, isMuted };
})();
