// i18n: Sprachsystem (Deutsch + Englisch) für Menü-, Einstellungs- und Pause-Texte.
// Andere Module lesen Strings live über t(); setLang() schaltet ohne Neustart um.

import { Settings } from './settings.js';

export const LANG_NAMES = { de: 'Deutsch', en: 'English' };

// Übersetzungstabelle. Platzhalter {0}, {1} … werden von t(key, ...args) ersetzt.
export const LANGS = {
  de: {
    // Hauptmenü
    'menu.singleplayer': 'Einzelspieler',
    'menu.multiplayer': 'Mehrspieler',
    'menu.settings': 'Einstellungen',
    'menu.quit': 'Beenden',
    'menu.back': '‹ Zurück',
    // Einzelspieler
    'sp.seedPlaceholder': 'Seed (leer = zufällig)',
    'sp.modeSurvival': 'Spielmodus: Überleben',
    'sp.modeCreative': 'Spielmodus: Kreativ',
    'sp.newWorld': 'Neue Welt',
    'sp.continue': 'Welt fortsetzen',
    'sp.delete': 'Welt löschen',
    'sp.deleteConfirm': 'Gespeicherte Welt wirklich löschen?',
    'sp.deleted': 'Welt gelöscht',
    'sp.worldName': 'Weltname (leer = automatisch)',
    'sp.create': 'Neue Welt erstellen',
    'sp.savedWorlds': 'Gespeicherte Welten',
    'sp.noWorlds': 'Noch keine gespeicherten Welten',
    'sp.load': 'Laden',
    'sp.creative': 'Kreativ',
    'sp.survival': 'Überleben',
    // Mehrspieler
    'mp.namePlaceholder': 'Spielername',
    'mp.addrPlaceholder': 'Server-Adresse (leer = dieser Server)',
    'mp.join': 'Mehrspieler beitreten',
    'mp.rejoin': 'Wieder verbinden',
    'mp.defaultName': 'Spieler',
    'mp.prevServers': 'Vorherige Server',
    'mp.noServers': 'Noch keine Server',
    'mp.connect': 'Verbinden',
    'mp.online': 'Online',
    'mp.offline': 'Offline',
    'mp.checking': 'Prüfe …',
    'mp.thisServer': 'Dieser Server',
    // Einstellungen
    'set.title': 'Einstellungen',
    'set.language': 'Sprache',
    'set.renderDistance': 'Sichtweite: {0} Chunks ({1} Blöcke)',
    'set.renderHint': 'Bis {0} Chunks volle Voxel-Details — darüber wird entferntes Gelände ' +
      'vereinfacht dargestellt (Höhenprofil mit Biomfarben). Sehr hohe Werte kosten Leistung. ' +
      'Wirkt sofort, ohne Neustart.',
    'set.creativeSpeed': 'Lauftempo im Kreativmodus: ×{0}',
    'set.done': 'Fertig',
    'set.close': 'Schließen',
    // Abschnitte & neue Optionen
    'set.sec.graphics': 'Grafik',
    'set.sec.performance': 'Leistung',
    'set.sec.controls': 'Steuerung',
    'set.clouds': 'Wolken am Himmel',
    'set.on': 'An',
    'set.off': 'Aus',
    'set.maxFps': 'Bildrate-Grenze: {0}',
    'set.unlimited': 'Unbegrenzt',
    'set.vsync': 'VSync (an Monitor koppeln)',
    'set.vsyncHint': 'VSync koppelt die Bildrate an deinen Monitor (flüssig, kein Tearing). ' +
      'Zum Nutzen der Bildrate-Grenze VSync ausschalten.',
    'set.rebindHint': 'Zum Ändern anklicken und neue Taste drücken · Esc bricht ab',
    'set.rebindWait': '… Taste drücken …',
    'set.resetKeys': 'Steuerung zurücksetzen',
    // Aktionsnamen der Tastenbelegung
    'key.forward': 'Vorwärts',
    'key.back': 'Rückwärts',
    'key.left': 'Links',
    'key.right': 'Rechts',
    'key.jump': 'Springen',
    'key.sneak': 'Schleichen',
    'key.sprint': 'Sprinten',
    'key.inventory': 'Inventar',
    'key.drop': 'Item fallen lassen',
    'key.chat': 'Chat',
    // Pause
    'pause.title': 'Pause',
    'pause.resume': 'Weiterspielen',
    'pause.save': 'Speichern',
    'pause.saved': 'Gespeichert',
    'pause.biome': 'Biom-Teleport',
    'pause.mainMenu': 'Zurück zum Hauptmenü',
    // Laden / Biom-Teleport
    'loading.world': 'Welt wird generiert…',
    'biome.title': 'Biom-Teleport',
    'biome.prompt': 'Nächstes Vorkommen suchen und hinspringen:',
    // Hinweise
    'toast.clickToPlay': 'Klicken, um zu spielen',
  },
  en: {
    // Main menu
    'menu.singleplayer': 'Singleplayer',
    'menu.multiplayer': 'Multiplayer',
    'menu.settings': 'Settings',
    'menu.quit': 'Quit',
    'menu.back': '‹ Back',
    // Singleplayer
    'sp.seedPlaceholder': 'Seed (empty = random)',
    'sp.modeSurvival': 'Game mode: Survival',
    'sp.modeCreative': 'Game mode: Creative',
    'sp.newWorld': 'New World',
    'sp.continue': 'Continue World',
    'sp.delete': 'Delete World',
    'sp.deleteConfirm': 'Really delete the saved world?',
    'sp.deleted': 'World deleted',
    'sp.worldName': 'World name (empty = auto)',
    'sp.create': 'Create new world',
    'sp.savedWorlds': 'Saved worlds',
    'sp.noWorlds': 'No saved worlds yet',
    'sp.load': 'Load',
    'sp.creative': 'Creative',
    'sp.survival': 'Survival',
    // Multiplayer
    'mp.namePlaceholder': 'Player name',
    'mp.addrPlaceholder': 'Server address (empty = this server)',
    'mp.join': 'Join multiplayer',
    'mp.rejoin': 'Reconnect',
    'mp.defaultName': 'Player',
    'mp.prevServers': 'Previous servers',
    'mp.noServers': 'No servers yet',
    'mp.connect': 'Connect',
    'mp.online': 'Online',
    'mp.offline': 'Offline',
    'mp.checking': 'Checking …',
    'mp.thisServer': 'This server',
    // Settings
    'set.title': 'Settings',
    'set.language': 'Language',
    'set.renderDistance': 'Render distance: {0} chunks ({1} blocks)',
    'set.renderHint': 'Full voxel detail up to {0} chunks — beyond that, distant terrain is ' +
      'simplified (height profile with biome colors). Very high values cost performance. ' +
      'Applies instantly, no restart.',
    'set.creativeSpeed': 'Creative movement speed: ×{0}',
    'set.done': 'Done',
    'set.close': 'Close',
    // Sections & new options
    'set.sec.graphics': 'Graphics',
    'set.sec.performance': 'Performance',
    'set.sec.controls': 'Controls',
    'set.clouds': 'Clouds in the sky',
    'set.on': 'On',
    'set.off': 'Off',
    'set.maxFps': 'Frame rate limit: {0}',
    'set.unlimited': 'Unlimited',
    'set.vsync': 'VSync (sync to monitor)',
    'set.vsyncHint': 'VSync locks the frame rate to your monitor (smooth, no tearing). ' +
      'Turn VSync off to use the frame rate limit.',
    'set.rebindHint': 'Click to change, then press a new key · Esc cancels',
    'set.rebindWait': '… press a key …',
    'set.resetKeys': 'Reset controls',
    // Keybind action names
    'key.forward': 'Forward',
    'key.back': 'Backward',
    'key.left': 'Left',
    'key.right': 'Right',
    'key.jump': 'Jump',
    'key.sneak': 'Sneak',
    'key.sprint': 'Sprint',
    'key.inventory': 'Inventory',
    'key.drop': 'Drop item',
    'key.chat': 'Chat',
    // Pause
    'pause.title': 'Pause',
    'pause.resume': 'Resume',
    'pause.save': 'Save',
    'pause.saved': 'Saved',
    'pause.biome': 'Biome teleport',
    'pause.mainMenu': 'Back to main menu',
    // Loading / biome teleport
    'loading.world': 'Generating world…',
    'biome.title': 'Biome teleport',
    'biome.prompt': 'Find the nearest occurrence and jump there:',
    // Toasts
    'toast.clickToPlay': 'Click to play',
  },
};

// Lustige Zufalls-Sprüche fürs Hauptmenü (Minecraft-Stil), je Sprache.
const SPLASHES = {
  de: [
    'Zu 100 % aus Pixeln!', 'Jetzt mit noch mehr Blöcken!', 'Kein einziges Bild-Asset!',
    'Prozedural bis in die Wurzeln!', 'Vorsicht vor Creepern!', 'Grüße an alle Dorfbewohner!',
    'Baumfrei? Niemals!', 'Enthält Spuren von Diamanten.', 'Hergestellt aus Seed und Liebe.',
    'Auch offline spielbar!', 'Drück nicht auf den roten Block!', 'Frisch aus dem Ofen!',
    'Mehr Bäume als dein Browser verträgt!', 'Jetzt mit Regenbogen-Holz!', 'Nachts wird’s gruselig.',
    'Schaufel nicht mitgeliefert.', 'Läuft sogar auf dem Toaster!', 'Voxelig!', 'Mind. 19 Biome!',
    'Bau dir dein eigenes Schloss!', 'Zombies hassen diesen Trick!', 'Der Seed war’s!',
    'Grabe niemals gerade nach unten!', 'Blockig und stolz drauf!', 'Katzenvideos nicht enthalten.',
    'Wo ist mein Bett?', 'Kein Handbuch, viel Spaß!', 'Achtung, Suchtgefahr!',
    'Iss dein Gemüse … oder Schweine.', 'Kühe geben hier keine Milch … oder doch?',
  ],
  en: [
    'Made of 100% pixels!', 'Now with even more blocks!', 'Not a single image asset!',
    'Procedural to the core!', 'Beware of creepers!', 'Say hi to the villagers!',
    'Tree-free? Never!', 'Contains traces of diamonds.', 'Made with seed and love.',
    'Playable offline too!', 'Do not press the red block!', 'Fresh out of the furnace!',
    'More trees than your browser can handle!', 'Now with rainbow wood!', 'It gets spooky at night.',
    'Shovel not included.', 'Runs on a toaster!', 'Voxelicious!', 'At least 19 biomes!',
    'Build your own castle!', 'Zombies hate this trick!', 'The seed did it!',
    'Never dig straight down!', 'Blocky and proud!', 'Cat videos not included.',
    'Where is my bed?', 'No manual, have fun!', 'Warning: highly addictive!',
    'Eat your veggies … or pigs.', 'Cows give no milk here … or do they?',
  ],
};

const _listeners = [];

export function getLang() {
  return LANGS[Settings.lang] ? Settings.lang : 'de';
}

export function setLang(l) {
  if (l !== 'de' && l !== 'en') return;
  Settings.lang = l;
  Settings.save();
  for (const cb of _listeners) { try { cb(l); } catch { /* Listener-Fehler nie fatal */ } }
}

// Callback bei jedem Sprachwechsel — die UI hängt hier ihre Neu-Übersetzung ein.
export function onLangChange(cb) { _listeners.push(cb); }

// Übersetzt key in die aktive Sprache; fehlt der Schlüssel, Fallback auf Deutsch, dann key selbst.
export function t(key, ...args) {
  const lang = getLang();
  let s = LANGS[lang] && LANGS[lang][key];
  if (s == null) s = LANGS.de[key];
  if (s == null) return key;
  return s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? args[i] : m));
}

// Ein zufälliger Menü-Spruch in der aktiven Sprache.
export function randomSplash() {
  const list = SPLASHES[getLang()] || SPLASHES.de;
  return list[Math.floor(Math.random() * list.length)];
}
