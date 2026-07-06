// Boot + game loop. Assembles the shared ctx and wires all modules together.

import * as THREE from 'three';
import { Rules, applyRules } from '../config.js';
import { Sounds } from './sounds.js';
import { createAtlas, updateAnimatedTiles } from './textures.js';
import { findSpawn, heightAt } from './worldgen.js';
import { World } from './world.js';
import { Fluids } from './fluids.js';
import { Furnaces } from './furnaces.js';
import { Brewing } from './brewing.js';
import { Washer } from './washer.js';
import { Redstone } from './redstone.js';
import { Flora } from './flora.js';
import { Fireflies } from './fireflies.js';
import { Clouds } from './clouds.js';
import { SpecialBlocks } from './blocks.js';
import { FarTerrain } from './farterrain.js';
import { DayNight } from './daynight.js';
import { EntityManager } from './entities.js';
import { Inventory } from './inventory.js';
import { Survival } from './survival.js';
import { Experience } from './experience.js';
import { Player } from './player.js';
import { SaveManager } from './save.js';
import { UI } from './ui.js';
import { Net } from './net.js';
import { t } from './lang.js';
import { Settings } from './settings.js';
import { hasValidSession, isConfigured } from './auth.js';

// Nach einem GPU-Reset kann die Kontext-Erstellung direkt nach dem Reload noch
// fehlschlagen — dann mit Wartezeit erneut versuchen statt schwarz zu bleiben.
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false });
  sessionStorage.removeItem('fablemc.glretry');
} catch (err) {
  const tries = Number(sessionStorage.getItem('fablemc.glretry') || 0);
  if (tries < 5) {
    sessionStorage.setItem('fablemc.glretry', String(tries + 1));
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      "background:#141a2e;color:#fff;font-family:'Courier New',monospace;font-size:18px;text-align:center;";
    msg.textContent = `Grafik wird neu initialisiert… automatischer Neustart (Versuch ${tries + 1}/5)`;
    document.body.appendChild(msg);
    setTimeout(() => location.reload(), 2500 * (tries + 1));
  }
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1500);

const ctx = {
  renderer, scene, camera,
  seed: 0,
  state: {
    paused: false, uiOpen: false, dead: false, time: 0, gameStarted: false,
    mode: 'survival', spectator: false,
  },
  sounds: Sounds,
  textures: createAtlas(),
  requestLock() {
    try {
      const p = renderer.domElement.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* pointer-lock cooldown etc. */ }
  },
};
window.__game = ctx;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (ctx.player?.handCam) {
    ctx.player.handCam.aspect = camera.aspect;
    ctx.player.handCam.updateProjectionMatrix();
  }
});

// audio needs a user gesture
document.addEventListener('click', () => Sounds.init(), { once: true });

// GPU-Reset (häufige "Absturz"-Ursache): loggen und automatisch neu laden — Autosave fängt es ab
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  window.__crashlog?.handle('webgl', 'WebGL-Kontext verloren (Grafiktreiber-Reset). Seite lädt in 3 s neu…', '');
  ctx.save?.save();
  setTimeout(() => location.reload(), 3000);
});

// accidental Strg+W / tab close protection while a world is running.
// In der Electron-App entfällt das: dort gibt es keine Browser-Hotkeys (kein Menü),
// und ein blockierendes beforeunload würde das Schließen des Fensters verhindern.
const istElectron = /electron/i.test(navigator.userAgent);
window.addEventListener('beforeunload', (e) => {
  if (ctx.state.gameStarted && !istElectron) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// WebGL-Kontext beim Verlassen sauber freigeben — sonst sammeln sich bei Reloads
// Kontexte an und Chromium blockiert die Seite („context loss and was blocked")
window.addEventListener('pagehide', () => {
  try {
    renderer.dispose();
    renderer.forceContextLoss();
  } catch { /* egal, wir verlassen die Seite */ }
});

const ui = new UI(ctx);
ctx.ui = ui;

function pregenerate() {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = () => {
      for (let i = 0; i < 12; i++) ctx.world.update(0.05, ctx.player.pos);
      if (
        ctx.world.isReadyAround(ctx.player.pos.x, ctx.player.pos.z, 1) ||
        performance.now() - start > 20000
      ) {
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    step();
  });
}

// Server in die Liste „vorherige Server" aufnehmen (neueste zuerst, max. 8, dedupliziert).
function rememberServer(name, adresse) {
  try {
    let list = JSON.parse(localStorage.getItem('fablemc.servers.v1') || '[]');
    if (!Array.isArray(list)) list = [];
    list = list.filter((s) => !(s.adresse === adresse && s.name === name));
    list.unshift({ name, adresse, updated: Date.now() });
    localStorage.setItem('fablemc.servers.v1', JSON.stringify(list.slice(0, 8)));
  } catch { /* Speicher voll — egal */ }
}

// Menü-Hintergrund: eine feste, leicht verschwommene Welt, die als Diorama langsam im
// Kreis rotiert. Die Kamera schwebt hoch ÜBER dem Gelände und blickt schräg nach unten,
// damit sie nie durch Blöcke klippt. Läuft bis der Spieler im Menü wählt.
function startMenuBackground() {
  try {
    const sky = new THREE.Color(0x8fbcff);
    const menuScene = new THREE.Scene();
    menuScene.background = sky;
    menuScene.fog = new THREE.Fog(sky, 70, 118);
    const menuCam = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);

    const seed = 1337; // fester, schöner Seed: Blumenwiese mit sanften Hügeln, viel Land
    const world = new World({ scene: menuScene, seed, textures: ctx.textures, renderDistance: 7 });

    const spawn = findSpawn(seed);
    const cx = spawn.x, cz = spawn.z;
    const rad = 44;
    // Höhe entlang der Umlaufbahn abtasten und die Kamera deutlich darüber legen → kein Klippen
    let maxSurf = spawn.y;
    for (let a = 0; a < 16; a++) {
      const sx = Math.round(cx + Math.cos((a / 16) * Math.PI * 2) * rad);
      const sz = Math.round(cz + Math.sin((a / 16) * Math.PI * 2) * rad);
      maxSurf = Math.max(maxSurf, heightAt(seed, sx, sz));
    }
    const eye = maxSurf + 30;                                   // klar über allem
    const target = new THREE.Vector3(cx, spawn.y - 2, cz);      // schräger Blick nach unten auf den Anker
    let angle = Math.random() * Math.PI * 2;

    // Canvas leicht verschwommen + minimal vergrößert (kaschiert die weichen Blur-Ränder)
    const canvas = renderer.domElement;
    canvas.style.filter = 'blur(3px)';
    canvas.style.transform = 'scale(1.06)';

    let raf = 0, last = performance.now(), stopped = false;
    const frame = (now) => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      try {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        angle += dt * 0.04; // langsame Kreisbewegung
        menuCam.position.set(cx + Math.cos(angle) * rad, eye, cz + Math.sin(angle) * rad);
        menuCam.lookAt(target);
        const aspect = window.innerWidth / window.innerHeight;
        if (menuCam.aspect !== aspect) { menuCam.aspect = aspect; menuCam.updateProjectionMatrix(); }
        world.update(dt, menuCam.position);
        updateAnimatedTiles(dt);
        renderer.render(menuScene, menuCam);
      } catch (err) {
        stopped = true; // Frame-Fehler nie fatal — Menü bleibt bedienbar
        console.warn('Menü-Hintergrund gestoppt:', err.message);
      }
    };
    raf = requestAnimationFrame(frame);

    return {
      stop() {
        if (stopped) { try { world.dispose(); } catch { /* egal */ } return; }
        stopped = true;
        cancelAnimationFrame(raf);
        canvas.style.filter = '';
        canvas.style.transform = '';
        try { world.dispose(); } catch { /* Menü ist vorbei */ }
      },
    };
  } catch (e) {
    console.warn('Menü-Hintergrund nicht verfügbar:', e);
    return { stop() {} };
  }
}

async function boot() {
  const menuBg = startMenuBackground();
  // Konto-Pflicht (sobald in authconfig.js ein Server eingetragen ist): ohne gültige
  // Sitzung erst anmelden/registrieren. Ohne eingetragenen Server läuft das Spiel wie bisher.
  if (isConfigured() && !hasValidSession()) await ui.showAccount();
  const choice = await ui.showTitle();
  menuBg.stop();

  // Mehrspieler: erst verbinden — der Server liefert Seed, Änderungen, Truhen & Zeit
  let welcome = null;
  if (choice.mode === 'multiplayer') {
    ctx.net = new Net(ctx);
    ui.showLoading(true);
    try {
      welcome = await ctx.net.connect(choice.name, choice.adresse);
    } catch (e) {
      ui.showLoading(false);
      alert('Verbindung fehlgeschlagen: ' + e.message + '\nLäuft der Server? (npm run mp)');
      location.reload();
      return;
    }
    rememberServer(choice.name, choice.adresse || ''); // in die Liste „vorherige Server" aufnehmen
    applyRules(welcome.rules); // im Mehrspieler gelten die Regeln des Servers
    choice.seed = welcome.seed;
  }
  ctx.seed = choice.seed;
  ctx.worldId = choice.worldId || null;          // Einzelspieler: welche gespeicherte Welt
  ctx.worldName = choice.worldName || 'Welt';

  ctx.world = new World(ctx);
  ctx.fluids = new Fluids(ctx);
  ctx.furnaces = new Furnaces(ctx);
  ctx.brewing = new Brewing(ctx);
  ctx.washer = new Washer(ctx);
  ctx.redstone = new Redstone(ctx);
  ctx.flora = new Flora(ctx);
  ctx.fireflies = new Fireflies(ctx);
  ctx.blocks = new SpecialBlocks(ctx);
  ctx.farterrain = new FarTerrain(ctx);
  // Block-Änderungen wecken Fluide auf, stoßen Fallphysik & Laub-Zerfall an und prüfen Öfen
  ctx.onBlockEdit = (x, y, z, id, oldId) => {
    ctx.fluids.notify(x, y, z);
    ctx.entities?.notifyGravity(x, y + 1, z);
    ctx.entities?.notifyGravity(x, y, z);
    ctx.furnaces.onBlockChanged(x, y, z);
    ctx.brewing.onBlockChanged(x, y, z);
    ctx.washer.onBlockChanged(x, y, z);
    ctx.flora.notify(x, y, z, oldId);
    ctx.blocks.onBlockChanged(x, y, z);
  };
  ctx.daynight = new DayNight(ctx);
  ctx.clouds = new Clouds(ctx);
  ctx.entities = new EntityManager(ctx);
  ctx.inventory = new Inventory(ctx);
  ctx.survival = new Survival(ctx);
  ctx.experience = new Experience(ctx);
  ctx.player = new Player(ctx);
  ctx.save = new SaveManager(ctx);

  let saved = null;
  if (choice.mode === 'load') { saved = ctx.save.load(); if (saved?.name) ctx.worldName = saved.name; }
  if (welcome) {
    // geteilte Welt vom Server übernehmen
    ctx.state.mode = 'survival';
    ctx.world.applyEdits(welcome.edits || {});
    for (const [key, slots] of Object.entries(welcome.chests || {})) {
      ctx.blocks.chests.set(key, { slots: slots.map((s) => (s ? { ...s } : null)) });
    }
    ctx.state.time = welcome.time || 18;
    // Der Server merkt sich pro IP + Name den Spielerstand — wiederherstellen,
    // sofern vorhanden und der Spieler nicht tot gespeichert wurde
    const ps = welcome.playerState;
    if (ps && ps.player && (ps.survival?.health ?? 0) > 0) {
      try {
        ctx.player.restore(ps.player);
        ctx.survival.restore(ps.survival);
        ctx.inventory.restore(ps.inventory);
        ctx.experience.restore(ps.experience);
        ui.toast('Willkommen zurück — dein Stand wurde wiederhergestellt. T für Chat');
      } catch (e) {
        console.warn('Spielerstand unlesbar, frischer Start:', e);
        const s = findSpawn(ctx.seed);
        ctx.player.respawnAt(s.x, s.y, s.z);
      }
    } else {
      const s = findSpawn(ctx.seed);
      ctx.player.respawnAt(s.x, s.y, s.z);
      ui.toast(`Verbunden — Seed ${ctx.seed}. T für Chat`);
    }
  } else if (saved) {
    ctx.state.mode = saved.mode === 'creative' ? 'creative' : 'survival';
    ctx.world.applyEdits(saved.edits || {});
    ctx.state.time = saved.time || 0;
    ctx.player.restore(saved.player);
    ctx.survival.restore(saved.survival);
    ctx.inventory.restore(saved.inventory);
    ctx.experience.restore(saved.experience);
    ctx.furnaces.restore(saved.furnaces);
    ctx.brewing.restore(saved.brewing);
    ctx.washer.restore(saved.washer);
    ctx.flora.restore(saved.flora);
    ctx.blocks.restore(saved.blocks);
  } else {
    ctx.state.mode = choice.gamemode === 'creative' ? 'creative' : 'survival';
    ctx.state.time = Rules.startFraction * Rules.dayLengthSec; // Startzeit aus der config.js
    const s = findSpawn(ctx.seed);
    ctx.player.respawnAt(s.x, s.y, s.z);
  }

  ui.showLoading(true);
  await pregenerate();
  ui.showLoading(false);

  ctx.state.gameStarted = true;
  if (!welcome) ctx.save.startAutosave(); // im Mehrspieler speichert der Server
  if (!welcome) ui.toast(t('toast.clickToPlay'));

  // pointer lock wiring
  renderer.domElement.addEventListener('click', () => {
    const s = ctx.state;
    if (s.gameStarted && !s.uiOpen && !s.dead && !s.paused && !document.pointerLockElement) {
      ctx.requestLock();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    const s = ctx.state;
    if (!document.pointerLockElement && s.gameStarted && !s.uiOpen && !s.dead && !s.paused) {
      ui.showPause();
    }
  });

  startLoop();
}

function startLoop() {
  const STEP = 1 / 60;
  let last = performance.now();
  let acc = 0;
  let lastRender = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    // Bildraten-Grenze: rendert VSync die Bilder nicht (VSync aus) und ist ein Limit
    // gesetzt, überspringen wir dieses rAF, bis das Zeitbudget erreicht ist. Die
    // Simulation bleibt echtzeitgenau, weil dt bis zum nächsten Bild akkumuliert.
    if (!Settings.vsync && Settings.maxFps > 0) {
      if (now - lastRender < 1000 / Settings.maxFps - 0.6) return;
    }
    lastRender = now;
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    const s = ctx.state;

    // Im Mehrspieler läuft die geteilte Welt im Pausemenü WEITER (wie in Minecraft):
    // andere spielen weiter, der Host simuliert weiter Mobs & Events. Nur im
    // Einzelspieler friert die Simulation im Pausemenü wirklich ein.
    const frozen = s.paused && !ctx.net?.active;

    if (!frozen) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 4) {
        ctx.player.update(STEP);
        ctx.entities.update(STEP);
        ctx.survival.update(STEP);
        ctx.experience.update(STEP);
        ctx.inventory.update(STEP); // Ofen-Schmelzen
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = 0; // don't spiral after long frames
    }

    // Als Host zusätzliche Anker: um Mitspieler hält die Welt Chunk-Daten vor,
    // damit dort Mobs spawnen können (nur Daten, nicht gerendert).
    const weltAnker = (ctx.net?.active && ctx.net.isHost)
      ? [...ctx.net.remote.values()].map((r) => r.mesh.position) : [];
    ctx.world.update(dt, ctx.player.pos, weltAnker);
    if (!frozen) {
      ctx.fluids.update(dt);
      ctx.furnaces.update(dt);
      ctx.brewing.update(dt);
      ctx.washer.update(dt);
      ctx.redstone.update(dt);
      ctx.flora.update(dt);
      ctx.fireflies.update(dt); // Glühwürmchen nachts über Gras
      ctx.blocks.update(dt); // Truhen-Ereignisse (Dschungeltempel)
    }
    ctx.farterrain.update(dt, ctx.player.pos);
    ctx.daynight.update(dt);
    ctx.clouds.update(); // Wolken folgen dem Spieler, driften mit der Weltzeit
    ctx.net?.update(dt); // Mehrspieler: Position senden, Avatare bewegen
    updateAnimatedTiles(dt); // Kelp & Seegras wehen (Atlas-Frames)
    ui.update(dt);
    renderer.render(scene, camera);
    // Render-Statistik der WELT festhalten (der Hand-Pass würde sie überschreiben)
    ctx.renderStats = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
    // First-Person-Hand als zweiter Pass (immer über der Welt, nie in Wänden)
    if (!s.spectator && !s.dead) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(ctx.player.handScene, ctx.player.handCam);
      renderer.autoClear = true;
    }
  }
  requestAnimationFrame(frame);
}

boot();
