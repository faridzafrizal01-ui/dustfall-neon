// Procedural sound only: every effect is an oscillator or filtered noise from the Web
// Audio API, built on first user gesture. No audio files, no network. A single shared
// noise buffer is made once and reused by every effect.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(dur, filterFreq, type, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 0.3, dur);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'rifle') { noise(0.09, 1800, 'lowpass', 0.9); tone(160, 0.08, 'square', 0.25, 60); }
      else if (kind === 'smg') { noise(0.06, 2400, 'bandpass', 0.7); tone(220, 0.05, 'square', 0.18, 90); }
      else { noise(0.08, 1200, 'lowpass', 0.8); tone(140, 0.07, 'square', 0.22, 70); }
    },
    enemyShot() { noise(0.08, 900, 'lowpass', 0.35); tone(110, 0.07, 'square', 0.12, 55); },
    dry() { tone(1200, 0.03, 'square', 0.12); },
    hit() { tone(1900, 0.05, 'sine', 0.3); },
    kill() { tone(660, 0.09, 'sine', 0.3); tone(990, 0.12, 'sine', 0.3, 0, 0.08); },
    hurt() { noise(0.12, 500, 'lowpass', 0.5); tone(90, 0.15, 'sawtooth', 0.2, 45); },
    reload() { tone(900, 0.04, 'square', 0.15); tone(700, 0.04, 'square', 0.15, 0, 0.35); },
    click() { tone(1400, 0.03, 'square', 0.12); },
    beep(high) { tone(high ? 1320 : 880, 0.09, 'sine', 0.25); },
    plantDone() { tone(520, 0.15, 'sine', 0.3); tone(780, 0.2, 'sine', 0.3, 0, 0.14); },
    explosion() {
      noise(0.7, 300, 'lowpass', 1.0);
      tone(70, 0.6, 'sine', 0.7, 28);
      noise(0.25, 3000, 'highpass', 0.4);
    },
    bounce() { tone(300, 0.05, 'sine', 0.12, 180); },
    smoke() {
      // A soft vapour hiss as the cloud pops open.
      noise(0.5, 1200, 'bandpass', 0.4);
      noise(0.3, 400, 'lowpass', 0.25, 0.1);
    },
    roundWin() { tone(523, 0.14, 'sine', 0.3); tone(659, 0.14, 'sine', 0.3, 0, 0.13); tone(784, 0.22, 'sine', 0.3, 0, 0.26); },
    roundLose() { tone(392, 0.16, 'sine', 0.28); tone(311, 0.16, 'sine', 0.28, 0, 0.15); tone(233, 0.28, 'sine', 0.28, 0, 0.3); },
  };
}
