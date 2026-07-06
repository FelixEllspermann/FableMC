// Seedable PRNG + Perlin noise (2D/3D) + helpers. No dependencies.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fast deterministic hash of an integer 2D coordinate -> [0,1)
export function hash2(seed, x, z) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function buildPerm(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

function grad2(h, x, y) {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return x - y;
    case 2: return -x + y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

export function makeNoise2D(seed) {
  const perm = buildPerm(seed);
  return function (x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xi = X & 255, yi = Y & 255;
    x -= X; y -= Y;
    const u = fade(x), v = fade(y);
    const a = perm[xi] + yi, b = perm[xi + 1] + yi;
    const n = lerp(
      lerp(grad2(perm[a], x, y), grad2(perm[b], x - 1, y), u),
      lerp(grad2(perm[a + 1], x, y - 1), grad2(perm[b + 1], x - 1, y - 1), u),
      v
    );
    return Math.max(-1, Math.min(1, n * 0.85));
  };
}

function grad3(h, x, y, z) {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : (g === 12 || g === 14 ? x : z);
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

export function makeNoise3D(seed) {
  const perm = buildPerm(seed);
  return function (x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    x -= X; y -= Y; z -= Z;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    const n = lerp(
      lerp(
        lerp(grad3(perm[AA], x, y, z), grad3(perm[BA], x - 1, y, z), u),
        lerp(grad3(perm[AB], x, y - 1, z), grad3(perm[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(grad3(perm[AA + 1], x, y, z - 1), grad3(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad3(perm[AB + 1], x, y - 1, z - 1), grad3(perm[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
    return Math.max(-1, Math.min(1, n * 0.97));
  };
}

// Fractal Brownian motion over a 2D noise function. Returns ~[-1,1].
export function fbm2(noiseFn, x, z, octaves, lacunarity, gain) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noiseFn(x * freq, z * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal (Musgrave): sharp creases at multiple scales. Each octave is
// weighted by the previous one, so detail comes and goes across the landscape
// instead of looking uniformly bumpy. Returns ~0..1.
export function ridgedFbm(noiseFn, x, z, octaves, lacunarity, gain) {
  let sum = 0, amp = 0.5, freq = 1, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let v = 1 - Math.abs(noiseFn(x * freq, z * freq));
    v *= v;
    v *= prev;
    prev = Math.min(1, v * 2);
    sum += v * amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum;
}
