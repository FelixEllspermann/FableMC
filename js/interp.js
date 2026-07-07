// Snapshot-Interpolation für den Mehrspieler (Jitter-Buffer).
//
// Problem bei hohem Ping (z. B. 250 ms) über WebSocket/TCP: Positions-Updates kommen
// verspätet und ungleichmäßig (Jitter, Head-of-Line-Blocking) an — mal ein kurzer
// Stau, dann ein Schwung Pakete auf einmal. Wer zur „zuletzt empfangenen" Position
// zieht, bekommt Nachziehen; wer nach ANKUNFTSZEIT interpoliert, bekommt Sprünge
// (die Ankunfts-Abstände entsprechen nicht den echten Sende-Abständen).
//
// Lösung wie in echten Netcode-Engines: jeder Snapshot trägt einen SENDER-Zeitstempel
// (st). Wir interpolieren auf DIESER Zeitachse und spielen sie mit einer eigenen,
// leicht verzögerten Abspiel-Uhr (tp) ab. Die Uhr läuft in Echtzeit weiter und wird
// sanft nachgeführt (Tempo ±25 %), um Drift & Bursts auszugleichen. So bleibt die
// Bewegung flüssig — auch wenn Pakete klumpen oder ein TCP-Stau die Zustellung staut.

export function lerpAngle(a, b, f) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

export class SnapshotBuffer {
  // delayMs: wie weit hinter dem neuesten Snapshot abgespielt wird (Jitter-Polster).
  constructor(delayMs = 120) {
    this.s = [];        // { st, x, y, z, yaw } — aufsteigend nach Sender-Zeit st
    this.delay = delayMs;
    this.tp = null;     // Abspiel-Uhr in der Sender-Zeitachse
  }

  // Neuen Snapshot einsortieren. st = Sender-Zeitstempel (ms, z. B. performance.now()
  // auf dem Absender). TCP liefert in Reihenfolge; ältere/gleiche st werden ignoriert.
  push(st, x, y, z, yaw = 0) {
    const last = this.s[this.s.length - 1];
    if (last && st <= last.st) {
      if (st === last.st) { last.x = x; last.y = y; last.z = z; last.yaw = yaw; }
      return;
    }
    this.s.push({ st, x, y, z, yaw });
    while (this.s.length > 60) this.s.shift(); // Deckel gegen unbegrenztes Wachstum
  }

  // Um dtMs weiterspielen und die interpolierte Position liefern (null, wenn leer).
  advance(dtMs) {
    const n = this.s.length;
    if (!n) return null;
    const newest = this.s[n - 1].st;
    const target = newest - this.delay;        // Soll-Position der Abspiel-Uhr
    if (this.tp === null) this.tp = target;
    // Abspieltempo leicht anpassen: hinterher → schneller, voraus → langsamer (max ±25 %).
    const err = target - this.tp;
    const speed = Math.max(0.75, Math.min(1.25, 1 + err * 0.002));
    this.tp += dtMs * speed;
    if (this.tp > newest) this.tp = newest;    // nie über das Neueste hinaus (kein Raten)
    if (this.tp < this.s[0].st) this.tp = this.s[0].st;
    return this._at(this.tp);
  }

  _at(tp) {
    const s = this.s, n = s.length;
    if (tp <= s[0].st) return { x: s[0].x, y: s[0].y, z: s[0].z, yaw: s[0].yaw };
    const last = s[n - 1];
    if (tp >= last.st) return { x: last.x, y: last.y, z: last.z, yaw: last.yaw };
    for (let i = 0; i < n - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (tp >= a.st && tp <= b.st) {
        const f = (tp - a.st) / ((b.st - a.st) || 1);
        return {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: lerpAngle(a.yaw, b.yaw, f),
        };
      }
    }
    return { x: last.x, y: last.y, z: last.z, yaw: last.yaw };
  }

  get length() { return this.s.length; }
}
