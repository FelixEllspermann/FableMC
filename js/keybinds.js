// Belegbare Tastatur-Steuerung. Aktionen -> KeyboardEvent.code, in localStorage
// gespeichert. Spielsysteme fragen Keybinds.get('forward') statt 'KeyW' fest zu verdrahten.

const KEY = 'fablemc.keybinds.v1';

// Reihenfolge = Anzeige-Reihenfolge im Einstellungsmenü
export const KEYBIND_ACTIONS = [
  'forward', 'back', 'left', 'right',
  'jump', 'sneak', 'sprint',
  'inventory', 'drop', 'chat',
];

const DEFAULTS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT',
};

export const Keybinds = {
  binds: { ...DEFAULTS },

  // aktuelle Belegung; null = bewusst nicht belegt (z. B. nach Konflikt geräumt)
  get(action) { return this.binds[action] ?? null; },

  // true, wenn code der Taste dieser Aktion entspricht (für keydown-Vergleiche)
  is(action, code) { return this.get(action) === code; },

  set(action, code) {
    if (!(action in DEFAULTS)) return;
    // dieselbe Taste nicht doppelt belegen: alte Belegung räumen
    for (const a of KEYBIND_ACTIONS) {
      if (a !== action && this.binds[a] === code) this.binds[a] = null;
    }
    this.binds[action] = code;
    this.save();
  },

  reset() { this.binds = { ...DEFAULTS }; this.save(); },

  isDefault(action) { return this.get(action) === DEFAULTS[action]; },

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && typeof d === 'object') {
        for (const a of KEYBIND_ACTIONS) {
          if (typeof d[a] === 'string') this.binds[a] = d[a];
        }
      }
    } catch { /* defaults */ }
  },

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.binds)); } catch { /* ignore */ }
  },
};

Keybinds.load();

// KeyboardEvent.code -> lesbare, kurze Beschriftung (weitgehend sprachneutral)
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map = {
    Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift ⇧',
    ControlLeft: 'Strg', ControlRight: 'Strg ⇧', AltLeft: 'Alt', AltRight: 'Alt Gr',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Feststell',
    Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']', Backquote: '`',
  };
  return map[code] || code;
}
