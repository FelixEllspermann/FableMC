// Procedural WebAudio sound effects. Lazy init on first user gesture; all no-op before init.

let actx = null;
let master = null;
let noiseBuffer = null;

function ensureNoise() {
  if (noiseBuffer) return;
  const len = actx.sampleRate * 0.4;
  noiseBuffer = actx.createBuffer(1, len, actx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

function noiseBurst(dur, freq, vol = 1, delay = 0) {
  if (!actx) return;
  ensureNoise();
  const t = actx.currentTime + delay;
  const src = actx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = actx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function blip(f0, f1, dur, type = 'sine', vol = 1) {
  if (!actx) return;
  const t = actx.currentTime;
  const osc = actx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(vol * 0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const Sounds = {
  init() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = 0.18;
      master.connect(actx.destination);
      if (actx.state === 'suspended') actx.resume();
    } catch {
      actx = null;
    }
  },
  blockBreak() { noiseBurst(0.12, 700, 1); },
  blockPlace() { noiseBurst(0.07, 1300, 0.7); },
  hurt() { blip(280, 110, 0.22, 'sawtooth', 0.9); },
  eat() {
    noiseBurst(0.08, 900, 0.7, 0);
    noiseBurst(0.08, 700, 0.7, 0.14);
    noiseBurst(0.08, 800, 0.7, 0.28);
  },
  pickup() { blip(420, 950, 0.09, 'sine', 0.7); },
  xp() { blip(660, 1050, 0.07, 'sine', 0.4); }, // sanftes „Ping" beim XP-Sammeln
  denied() { blip(200, 130, 0.16, 'square', 0.5); }, // tiefes „Nö" (z. B. zu wenig XP)
  levelUp() { // aufsteigende Dreiklang-Fanfare
    blip(523, 660, 0.12, 'sine', 0.6);
    setTimeout(() => blip(660, 784, 0.12, 'sine', 0.6), 90);
    setTimeout(() => blip(784, 1046, 0.2, 'sine', 0.55), 190);
  },
  jump() { noiseBurst(0.04, 900, 0.2); },
  splash() { noiseBurst(0.3, 480, 0.8); },
  shoot() { noiseBurst(0.08, 2200, 0.5); },
  door() { noiseBurst(0.06, 600, 0.6); blip(160, 90, 0.1, 'square', 0.35); },
  shear() { noiseBurst(0.05, 3200, 0.5); noiseBurst(0.05, 2800, 0.5, 0.09); },
  sheep() { blip(220, 180, 0.28, 'sawtooth', 0.5); blip(230, 170, 0.22, 'sawtooth', 0.4); },
  fuse() { noiseBurst(1.4, 5000, 0.3); },
  explode() {
    noiseBurst(0.6, 180, 1.6);
    blip(90, 35, 0.5, 'sine', 1.2);
  },
};
