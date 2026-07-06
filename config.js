// ─────────────────────────────────────────────────────────────────────────────
//  Fable MC — Welt-Regeln & Einstellungen
// ─────────────────────────────────────────────────────────────────────────────
//  Diese Werte anpassen und danach das Spiel bzw. den Server NEU STARTEN.
//  Gilt für Einzelspieler UND Server.
//
//  Mehrspieler: Es zählen die Regeln des SERVERS — Gäste übernehmen automatisch
//  die config.js, die der Server ausliefert. (PvP wird pro Welt in der
//  Steuerzentrale eingestellt, nicht hier.)
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  // ── Zeit & Welt ──────────────────────────────────────────────
  dayLengthMin: 40,      // Länge eines vollen Tag/Nacht-Zyklus in MINUTEN
                         //   (Standard 40 = 30 min Tag + 10 min Nacht)
  startTime: 'morgen',   // Startzeit neuer Welten: 'morgen' | 'mittag' | 'abend' | 'nacht'

  // ── Gesundheit & Überleben ──────────────────────────────────
  fallDamage: true,      // Fallschaden
  drowning: true,        // Ertrinken unter Wasser
  hunger: true,          // Hunger (false = kein Verhungern; Essen heilt weiterhin)
  naturalRegen: true,    // langsame Heilung, solange der Hunger hoch ist

  // ── Monster & Tiere ─────────────────────────────────────────
  spawnMonsters: true,   // Monster spawnen (nachts & in dunklen Höhlen)
  spawnAnimals: true,    // Tiere spawnen (Schweine, Schafe, Hühner, Fische)
  mobGriefing: true,     // Creeper & TNT zerstören Blöcke (false = nur Schaden, kein Krater)
};

// ── Laufzeit — nicht bearbeiten ──────────────────────────────────────────────
// Aktive, normalisierte Regeln. Einzelspieler = CONFIG; im Mehrspieler
// überschreibt der Server diese Werte (siehe applyRules).
const START_FRACTION = { morgen: 0.03, mittag: 0.375, abend: 0.65, nacht: 0.85 };

function normalize(c) {
  return {
    dayLengthSec: Math.max(60, Math.round((c.dayLengthMin ?? 40) * 60)),
    startFraction: START_FRACTION[c.startTime] ?? START_FRACTION.morgen,
    fallDamage: c.fallDamage !== false,
    drowning: c.drowning !== false,
    hunger: c.hunger !== false,
    naturalRegen: c.naturalRegen !== false,
    spawnMonsters: c.spawnMonsters !== false,
    spawnAnimals: c.spawnAnimals !== false,
    mobGriefing: c.mobGriefing !== false,
  };
}

export const Rules = normalize(CONFIG);

// Vom Server empfangene Regeln übernehmen (Mehrspieler). r ist bereits die
// normalisierte Rules-Form; fehlende Felder bleiben auf dem lokalen Standard.
export function applyRules(r) {
  if (r && typeof r === 'object') Object.assign(Rules, r);
}
