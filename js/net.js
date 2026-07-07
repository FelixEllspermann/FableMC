// Mehrspieler-Client: WebSocket-Verbindung, geteilte Block-Änderungen & Truhen,
// Mitspieler-Avatare mit Namensschild, Chat (T) und Server-Uhrzeit.
// Stufe 2: Der Host (erster Spieler) simuliert Mobs, Events und Spawner;
// Gäste rendern Snapshots und schicken Treffer/Aktionen an den Host.
// Flüssigkeiten und Deko-Physik bleiben deterministisch clientlokal.

import * as THREE from 'three';
import { armorStats } from './equip.js';
import { Keybinds } from './keybinds.js';
import { BLOCK, ITEM, BLOCKS, ITEMS } from './constants.js';
import { getSession } from './auth.js';
import { t } from './lang.js';
import { SnapshotBuffer } from './interp.js';

// Render-Verzögerung für fremde Avatare (ms). Positionen kommen 20×/s → 100 ms puffert
// ~2 Pakete + Jitter ab und macht die Bewegung trotz Ping ruckelfrei.
const INTERP_AVATAR = 100;

const CHAT_STYLE = `
.mp-chatlog {
  position: fixed; left: 8px; bottom: 96px; z-index: 30; max-width: 44vw;
  display: flex; flex-direction: column; gap: 2px; pointer-events: none;
  font-size: 14px; line-height: 1.35;
}
.mp-chatlog .zeile {
  background: rgba(0,0,0,0.45); color: #fff; padding: 3px 8px; border-radius: 3px;
  opacity: 1; transition: opacity 1s;
}
.mp-chatlog .zeile.alt { opacity: 0; }
.mp-chatlog .zeile b { color: #8ec8ff; }
.mp-chatinput {
  position: fixed; left: 8px; bottom: 64px; z-index: 31; width: 44vw; display: none;
  background: rgba(0,0,0,0.7); color: #fff; border: 1px solid #5a8ac8;
  padding: 7px 10px; font-size: 14px; outline: none;
}
.mp-tablist {
  position: fixed; top: 44px; left: 50%; transform: translateX(-50%); z-index: 40;
  display: none; background: rgba(10,14,26,0.82); border: 1px solid #2a3557;
  border-radius: 8px; padding: 8px 4px; min-width: 300px; max-width: 60vw;
  font-size: 14px; color: #e8ecf5; pointer-events: none;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.mp-tablist .tl-kopf {
  text-align: center; color: #9aa6c9; font-size: 12px; text-transform: uppercase;
  letter-spacing: .5px; padding: 2px 12px 8px; border-bottom: 1px solid #2a3557; margin-bottom: 6px;
}
.mp-tablist .tl-zeile { display: flex; justify-content: space-between; gap: 26px; padding: 3px 16px; }
.mp-tablist .tl-name { font-weight: 600; white-space: nowrap; }
.mp-tablist .tl-ping { font-variant-numeric: tabular-nums; }
`;

export class Net {
  constructor(ctx) {
    this.ctx = ctx;
    this.ws = null;
    this.id = 0;
    this.hostId = 0;             // wer Mobs & Events simuliert
    this.pvp = false;            // Spieler-vs-Spieler erlaubt (vom Server)
    this.mod = false;            // bin ich Moderator? (für /help-Hinweise)
    this.roster = [];            // [{ id, name, ping, mod }] für die Tab-Übersicht
    this._swingTimer = 0;        // drosselt das Senden von Arm-Schwüngen
    this.applyingRemote = false; // Echo-Schutz beim Anwenden fremder Edits
    this.remote = new Map();     // id → { name, mesh, label, ziel {x,y,z,yaw} }
    this._moveTimer = 0;
    this._entsTimer = 0;
    this._pstateTimer = 8; // erster Spielstand-Sync kurz nach dem Beitritt
    this._rausgeworfen = false; // gekickt/gebannt → keine „Verbindung verloren"-Meldung
    this._chatOpen = false;

    // Spielstand auch beim Verlassen/Tab-Wechsel sichern (best effort)
    window.addEventListener('beforeunload', () => this._sendePstate());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._sendePstate();
    });

    const style = document.createElement('style');
    style.textContent = CHAT_STYLE;
    document.head.appendChild(style);
    this.logEl = document.createElement('div');
    this.logEl.className = 'mp-chatlog';
    document.body.appendChild(this.logEl);
    this.inputEl = document.createElement('input');
    this.inputEl.className = 'mp-chatinput';
    this.inputEl.placeholder = 'Nachricht … (Enter senden, Esc schließen)';
    this.inputEl.maxLength = 200;
    document.body.appendChild(this.inputEl);
    this.tabEl = document.createElement('div');
    this.tabEl.className = 'mp-tablist';
    document.body.appendChild(this.tabEl);

    // Tab hält die Spielerliste offen (wie in Minecraft)
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      const s = this.ctx.state;
      if (!this.active || !s.gameStarted || s.uiOpen || s.dead || this._chatOpen) return;
      e.preventDefault();
      if (this.tabEl.style.display !== 'block') { this.tabEl.style.display = 'block'; this._renderTablist(); }
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.tabEl.style.display = 'none';
    }, true);

    // Chat öffnen mit T, senden mit Enter
    document.addEventListener('keydown', (e) => {
      if (!this.ws) return;
      if (this._chatOpen) {
        if (e.code === 'Enter') {
          const text = this.inputEl.value.trim();
          if (text) this._send({ type: 'chat', text });
          this.closeChat();
          e.preventDefault();
        } else if (e.code === 'Escape') {
          this.closeChat();
          e.preventDefault();
        }
        e.stopPropagation();
        return;
      }
      const s = this.ctx.state;
      if (e.code === Keybinds.get('chat') && s.gameStarted && !s.uiOpen && !s.dead && !s.paused &&
          !(e.target && e.target.tagName === 'INPUT')) {
        e.preventDefault();
        this.openChat();
      }
    }, true); // capture: fängt T ab, bevor das Spiel es sieht
  }

  get active() { return !!this.ws && this.ws.readyState === 1; }
  get chatOpen() { return this._chatOpen; }
  get isHost() { return !this.active || this.hostId === this.id; }

  openChat() {
    this._chatOpen = true;
    this.ctx.state.uiOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.inputEl.style.display = 'block';
    this.inputEl.value = '';
    setTimeout(() => this.inputEl.focus(), 0);
  }

  closeChat() {
    this._chatOpen = false;
    this.inputEl.style.display = 'none';
    this.inputEl.blur();
    this.ctx.state.uiOpen = false;
    const s = this.ctx.state;
    if (s.gameStarted && !s.paused && !s.dead) this.ctx.requestLock();
  }

  addChat(name, text, mod) {
    const z = document.createElement('div');
    z.className = 'zeile';
    const b = document.createElement('b');
    b.textContent = name + ': ';
    if (mod) b.style.color = '#ff5a5a'; // Moderatoren mit rotem Namen
    z.appendChild(b);
    z.appendChild(document.createTextNode(text));
    this.logEl.appendChild(z);
    while (this.logEl.children.length > 8) this.logEl.firstChild.remove();
    setTimeout(() => z.classList.add('alt'), 9000);
  }

  // Tab-Übersicht aus dem Server-Roster aufbauen (Mods mit ⭐ und rotem Namen)
  _renderTablist() {
    const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const pingFarbe = (p) => (p < 80 ? '#6ee79c' : p < 200 ? '#ffd24a' : '#ff7a6e');
    const rows = [...this.roster].sort((a, b) => (b.mod - a.mod) || a.name.localeCompare(b.name));
    this.tabEl.innerHTML =
      '<div class="tl-kopf">Spieler (' + rows.length + ')</div>' +
      (rows.length ? rows.map((p) => {
        const eigen = p.id === this.id ? ' (du)' : '';
        const nameHtml = (p.mod ? '⭐ ' : '') + esc(p.name) + eigen;
        return '<div class="tl-zeile">' +
          '<span class="tl-name"' + (p.mod ? ' style="color:#ff6b6b"' : '') + '>' + nameHtml + '</span>' +
          '<span class="tl-ping" style="color:' + pingFarbe(p.ping) + '">' + p.ping + ' ms</span></div>';
      }).join('') : '<div class="tl-zeile"><span class="tl-name">—</span></div>');
  }

  // Verbinden + auf das welcome-Paket warten (liefert Seed/Edits/Truhen/Zeit)
  connect(name, adresse) {
    return new Promise((resolve, reject) => {
      const url = adresse
        ? (adresse.startsWith('ws') ? adresse : 'ws://' + adresse)
        : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Zeitüberschreitung')); }, 8000);
      // Konto-Token mitschicken — ein Server mit Konto-Pflicht bestätigt damit den Namen.
      const token = getSession()?.token || '';
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', name, token }));
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Verbindung fehlgeschlagen')); };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'banned') { // gebannte IP: klare Meldung statt Timeout
          clearTimeout(timeout);
          ws.close();
          reject(new Error('Du bist auf diesem Server gebannt'));
          return;
        }
        if (msg.type === 'authfail') { // Konto-Pflicht: Token fehlt/ungültig/schon online
          clearTimeout(timeout);
          ws.close();
          const err = new Error(msg.reason || 'Anmeldung am Server fehlgeschlagen');
          err.auth = true;
          reject(err);
          return;
        }
        if (msg.type === 'welcome') {
          clearTimeout(timeout);
          this.ws = ws;
          this.id = msg.id;
          this.hostId = msg.hostId || msg.id;
          this.pvp = !!msg.pvp;
          this.mod = !!msg.mod;
          ws.onclose = () => this._onClose();
          ws.onmessage = (e2) => {
            let m;
            try { m = JSON.parse(e2.data); } catch { return; }
            this._onMessage(m);
          };
          for (const p of msg.players || []) this._addRemote(p.id, p.name, p);
          resolve(msg);
        }
      };
    });
  }

  _onClose() {
    this.ws = null;
    if (this._rausgeworfen) return; // Kick/Bann hat schon eine Meldung gezeigt
    this.addChat('⚙', t('hud.connLostChat'));
    this.ctx.ui?.toast(t('hud.connLost'));
  }

  // Eigenen Spielstand (Inventar, Position, Leben) an den Server schicken —
  // der sichert ihn pro IP + Name und gibt ihn beim nächsten Beitritt zurück.
  _sendePstate() {
    const ctx = this.ctx;
    if (!this.active || !ctx.state.gameStarted || ctx.state.dead) return;
    try {
      this._send({
        type: 'pstate',
        state: {
          player: ctx.player.serialize(),
          survival: ctx.survival.serialize(),
          experience: ctx.experience.serialize(),
          inventory: ctx.inventory.serialize(),
        },
      });
    } catch { /* Serialisierung darf das Spiel nie stören */ }
  }

  // Vom Server geworfen/gebannt: Meldung zeigen, dann zurück zum Titel
  _rauswurf(text) {
    this._rausgeworfen = true;
    this.ctx.ui?.toast(text);
    this.addChat('⚙', text);
    setTimeout(() => {
      this.ctx.state.gameStarted = false;
      alert(text);
      location.reload();
    }, 1500);
  }

  _send(msg) {
    if (this.active) this.ws.send(JSON.stringify(msg));
  }

  sendEdits(list) {
    if (!this.active || this.applyingRemote || !list.length) return;
    this._send({ type: 'edits', list });
  }

  sendChest(key, slots) {
    if (!this.active || this.applyingRemote) return;
    this._send({ type: 'chest', key, slots });
  }
  // Braustand-Zustand teilen (Slots + Fortschritt) — wie die Truhe, plus Timer vom Host
  sendBrew(key, state) {
    if (!this.active || this.applyingRemote) return;
    this._send({ type: 'brew', key, state });
  }
  // Washer-Zustand teilen (Eingabe/Wasser/Ausgabe + Fortschritt)
  sendWash(key, state) {
    if (!this.active || this.applyingRemote) return;
    this._send({ type: 'wash', key, state });
  }

  sendTime(time) { this._send({ type: 'time', time }); }

  // ---- Stufe 2: Mobs & Events ----
  // Gast → Host: „ich habe Mob eid geschlagen"
  sendHit(eid, dmg, kx, kz) {
    this._send({ type: 'hit', eid, dmg, kx: +kx.toFixed(2), kz: +kz.toFixed(2) });
  }
  // Host → Server → Gast: XP-Belohnung für einen Kill (Gast simuliert Mobs nicht selbst)
  sendXp(target, amount) { this._send({ type: 'xp', target, amount }); }
  // Gast → Host: Interaktion mit einem Mob (z. B. Schaf scheren)
  sendUse(eid, was) { this._send({ type: 'use', eid, was }); }
  // Gast → Host: TNT gezündet (Host spawnt & simuliert es, alle sehen es)
  sendIgniteTnt(x, y, z, fuse) { this._send({ type: 'igniteTnt', x, y, z, fuse: +(fuse || 4).toFixed(2) }); }
  // Gast → Host: Event-Kiste (Dschungel-Tempel) ausgelöst
  sendEvTrig(x, y, z) { this._send({ type: 'evtrig', x, y, z }); }
  // Host → Server → betroffener Spieler: Mob-Schaden an Mitspieler
  sendPlayerHit(target, dmg, kx, kz) {
    this._send({ type: 'phit', target, dmg, kx: +kx.toFixed(2), kz: +kz.toFixed(2) });
  }
  // Host → Server → betroffener Spieler: Boss-Brüllen verlangsamt Mitspieler
  sendPlayerSlow(target, dur) {
    this._send({ type: 'pslow', target, dur: +(dur || 4).toFixed(1) });
  }
  // Host → alle: Boss-Telegraf-Kreis (Boden-Schlag) sichtbar machen
  sendBossRing(x, y, z, r, dur) {
    this._send({ type: 'bossring', x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), r: +(r || 3.6).toFixed(2), dur: +(dur || 1.1).toFixed(2) });
  }
  // Jeder → alle: gedropptes Item (Wurf, Beute, Abbau) mit eindeutiger netId
  sendItemDrop(netId, x, y, z, id, count) {
    if (!this.active) return;
    this._send({
      type: 'idrop', netId, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), id, count,
    });
  }
  // Jeder → alle: Item mit netId aufgehoben → überall entfernen
  sendItemPick(netId) {
    if (this.active) this._send({ type: 'ipick', netId });
  }

  // ---- Sichtbare Aktionen (Arm-Schwung, Schaden, Tod, Respawn) ----
  sendSwing() { // gedrosselt, damit wiederholtes Abbauen den Server nicht flutet
    if (!this.active || this._swingTimer > 0) return;
    this._swingTimer = 0.18;
    this._send({ type: 'swing' });
  }
  sendHurt() { if (this.active) this._send({ type: 'phurt' }); }
  sendDead() { if (this.active) this._send({ type: 'pdead' }); }
  sendAlive() { if (this.active) this._send({ type: 'palive' }); }
  // Spieler schlägt Mitspieler (nur wenn PvP an) → Server leitet Schaden weiter
  sendPvp(target, dmg, kx, kz) {
    if (this.active && this.pvp) {
      this._send({ type: 'pvp', target, dmg, kx: +kx.toFixed(2), kz: +kz.toFixed(2) });
    }
  }

  _onMessage(m) {
    const ctx = this.ctx;
    switch (m.type) {
      case 'edits':
        this.applyingRemote = true;
        for (const [x, y, z, id] of m.list) ctx.world.setBlock(x, y, z, id);
        this.applyingRemote = false;
        break;
      case 'chest': {
        this.applyingRemote = true;
        const c = ctx.blocks.getChest(...m.key.split(',').map(Number));
        c.slots = m.slots.map((s) => (s ? { ...s } : null));
        this.applyingRemote = false;
        break;
      }
      case 'brew': { // Braustand-Zustand vom Host/Mitspieler übernehmen
        this.applyingRemote = true;
        const b = ctx.brewing?.get(...m.key.split(',').map(Number));
        const s = m.state || {};
        if (b) {
          b.bottles = s.bottles ? { ...s.bottles } : null;
          b.water = s.water ? { ...s.water } : null;
          b.ing1 = s.ing1 ? { ...s.ing1 } : null;
          b.ing2 = s.ing2 ? { ...s.ing2 } : null;
          b.progress = s.progress || 0;
          b._dirtyUI = true;
        }
        this.applyingRemote = false;
        break;
      }
      case 'wash': { // Washer-Zustand übernehmen
        this.applyingRemote = true;
        const w = ctx.washer?.get(...m.key.split(',').map(Number));
        const s = m.state || {};
        if (w) {
          w.input = s.input ? { ...s.input } : null;
          w.water = s.water ? { ...s.water } : null;
          w.output = s.output ? { ...s.output } : null;
          w.progress = s.progress || 0;
          w._dirtyUI = true;
        }
        this.applyingRemote = false;
        break;
      }
      case 'chat': this.addChat(m.name, m.text, m.mod); break;
      case 'ping': this._send({ type: 'pong', t: m.t }); break; // Ping beantworten
      case 'roster':
        this.roster = m.players || [];
        if (this.tabEl.style.display === 'block') this._renderTablist();
        break;
      case 'time': ctx.state.time = m.time; break;
      case 'join': this._addRemote(m.id, m.name, null); break;
      case 'leave': this._removeRemote(m.id); break;
      case 'move': {
        const r = this.remote.get(m.id);
        if (r) {
          r.buf.push(m.st ?? performance.now(), m.x, m.y, m.z, m.yaw); // in den Interpolations-Puffer (Sender-Zeit)
          if (m.held !== undefined) this._setHeld(r, m.held);
        }
        break;
      }
      case 'swing': { const r = this.remote.get(m.id); if (r) r.swing = 0.3; break; }
      case 'phurt': { const r = this.remote.get(m.id); if (r) r.flash = 0.2; break; }
      case 'pdead': {
        const r = this.remote.get(m.id);
        if (r && r.dead <= 0) {
          r.dead = 1.2;
          this.ctx.furnaces?.burst(r.mesh.position.x, r.mesh.position.y + 1, r.mesh.position.z, 22);
          this.addChat('⚙', t('hud.playerDied', r.name || t('hud.someone')));
        }
        break;
      }
      case 'palive': {
        const r = this.remote.get(m.id);
        if (r) { r.dead = 0; r.mesh.visible = true; r.mesh.rotation.z = 0; r.mesh.scale.setScalar(1); }
        break;
      }
      // ---- Stufe 2: Host-Autorität ----
      case 'host': { // Host-Wechsel (z. B. alter Host ging offline)
        this.hostId = m.id;
        // alte Remote-Mobs überall verwerfen — der neue Host baut frisch auf
        ctx.entities?.clearRemote();
        if (this.isHost) {
          ctx.ui?.toast(t('hud.becameHost'));
        }
        break;
      }
      case 'ents': // Snapshot des Hosts → Mobs nachziehen
        if (!this.isHost) ctx.entities?.applyRemoteSnapshot(m.list || [], m.st);
        break;
      case 'idrop': // Mitspieler hat ein Item gedroppt → lokal zeigen
        ctx.entities?.spawnRemoteItem(m.netId, m.x, m.y, m.z, m.id, m.count || 1);
        break;
      case 'ipick': // Mitspieler hat ein Item aufgehoben → überall entfernen
        ctx.entities?.removeItemByNetId(m.netId);
        break;
      case 'hit': // Gast hat Mob eid geschlagen → auf Host anwenden (m.von = Gast-id für XP)
        if (this.isHost) ctx.entities?.applyNetHit(m.eid, m.dmg || 1, m.kx || 0, m.kz || 0, m.von);
        break;
      case 'xp': // Host belohnt MICH mit XP für einen Kill
        ctx.experience?.add(m.amount || 0);
        break;
      case 'use': // Gast-Interaktion (Schaf scheren)
        if (this.isHost) ctx.entities?.applyNetUse(m.eid, m.was);
        break;
      case 'igniteTnt': // Gast hat TNT gezündet → Host spawnt es (host-autoritativ)
        if (this.isHost) ctx.entities?.spawnPrimedTnt(m.x, m.y, m.z, m.fuse || 4);
        break;
      case 'evtrig': // Gast hat Dschungel-Event ausgelöst → Host startet Wellen
        if (this.isHost) ctx.blocks?.triggerLootChest(m.x, m.y, m.z, m.von || 0);
        break;
      case 'phit': { // ein Mob/eine Explosion (beim Host) hat MICH getroffen
        const s = ctx.state;
        if (s.dead || s.mode !== 'survival' || s.spectator) break;
        ctx.survival.damage(m.dmg || 1, 'mob');
        if ((m.kx || m.kz) && !armorStats(ctx.inventory?.armor).kbImmune) {
          ctx.player.vel.x += m.kx || 0;
          ctx.player.vel.z += m.kz || 0;
          ctx.player.vel.y = Math.min(ctx.player.vel.y + 3.5, 7);
        }
        break;
      }
      case 'pslow': { // das Boss-Brüllen (beim Host) hat MICH verlangsamt
        const s = ctx.state;
        if (s.dead || s.mode !== 'survival' || s.spectator || !ctx.player.effects) break;
        ctx.player.effects.slow = Math.max(ctx.player.effects.slow || 0, m.dur || 4);
        ctx.ui?.toast?.('Das Brüllen lähmt dich!');
        break;
      }
      case 'bossring': // Host: Boden-Schlag angekündigt → Kreis auch bei mir zeigen
        ctx.entities?.showTelegraph(m.x, m.y, m.z, m.r || 3.6, m.dur || 1.1);
        break;
      case 'kicked': this._rauswurf(t('hud.kicked')); break;
      case 'banned': this._rauswurf(t('hud.banned')); break;
      case 'authfail': this._rauswurf('⛔ ' + (m.reason || t('hud.authfailDefault'))); break;
      // ---- Moderator-Befehle ----
      case 'cmd': this._applyCmd(m); break;                 // Server-Aktion an mich (tp/kill/give …)
      case 'modset': this.mod = !!m.on; break;              // Mod-Status geändert
      case 'pvpset': this.pvp = !!m.on; break;              // PvP zur Laufzeit umgeschaltet
    }
  }

  // Eine vom Server befohlene Aktion auf DIESEM Client ausführen (Mod-Befehle)
  _applyCmd(m) {
    const ctx = this.ctx;
    const ui = ctx.ui;
    switch (m.action) {
      case 'tp':
        ctx.player.pos.set(m.x, m.y, m.z);
        ctx.player.vel.set(0, 0, 0);
        ui?.toast(t('hud.teleported'));
        break;
      case 'kill':
        if (ctx.survival && !ctx.state.dead) {
          ctx.survival.health = 0;
          ctx.survival._die();
          ctx.survival.render?.();
        }
        break;
      case 'heal':
        if (ctx.survival) {
          ctx.survival.health = 20; ctx.survival.hunger = 20;
          ctx.survival.air = ctx.survival._maxAir ?? 10;
          ctx.survival.render?.(); ui?.toast(t('hud.healed'));
        }
        break;
      case 'feed':
        if (ctx.survival) { ctx.survival.hunger = 20; ctx.survival.render?.(); ui?.toast(t('hud.fed')); }
        break;
      case 'give': {
        const id = this._resolveItem(m.item);
        if (!id) { ui?.toast(t('hud.itemUnknown', m.item)); break; }
        ctx.inventory?.addItem(id, m.count || 1);
        ui?.toast(t('hud.received', m.count || 1, m.item));
        break;
      }
      case 'god':
        if (ctx.survival) {
          ctx.survival.god = !ctx.survival.god;
          ui?.toast(t('hud.invincible', ctx.survival.god ? t('hud.on') : t('hud.off')));
        }
        break;
      case 'fly':
        ctx.player.modFly = !ctx.player.modFly;
        ctx.player.flying = ctx.player.modFly;
        ui?.toast(t('hud.flying', ctx.player.modFly ? t('hud.on') : t('hud.off')));
        break;
      case 'gm':
        ctx.state.mode = m.mode === 'creative' ? 'creative' : 'survival';
        if (m.mode !== 'creative' && !ctx.player.modFly) ctx.player.flying = false;
        ui?.toast(t('hud.gamemode', m.mode === 'creative' ? t('hud.creative') : t('hud.survival')));
        break;
      case 'clear':
        if (ctx.inventory) {
          for (let i = 0; i < ctx.inventory.slots.length; i++) ctx.inventory.slots[i] = null;
          if (ctx.inventory.armor) for (const k of ['helmet', 'chest', 'legs', 'boots']) ctx.inventory.armor[k] = null;
          ctx.inventory._renderAll?.();
          ui?.toast(t('hud.invCleared'));
        }
        break;
    }
  }

  // Item-Name (z. B. „diamant", „diamond", „DIAMOND") oder Zahl → Block-/Item-id
  _resolveItem(name) {
    const raw = String(name || '').trim();
    if (/^\d+$/.test(raw)) return Number(raw);
    const norm = (t) => String(t).toLowerCase()
      .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
      .replace(/[\s_-]/g, '');
    if (!this._itemNameMap) {
      const map = {};
      const add = (id, ...ns) => { for (const nm of ns) { const k = norm(nm); if (k && !(k in map)) map[k] = id; } };
      for (const [key, id] of Object.entries(BLOCK)) add(id, key, BLOCKS[id]?.name);
      for (const [key, id] of Object.entries(ITEM)) add(id, key, ITEMS[id]?.name);
      this._itemNameMap = map;
    }
    return this._itemNameMap[norm(raw)] || 0;
  }

  // ---- Mitspieler-Avatare ----

  _addRemote(id, name, pos) {
    if (this.remote.has(id)) return;
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8b09c });
    const shirt = new THREE.MeshLambertMaterial({ color: 0x4a7dc8 });
    const hose = new THREE.MeshLambertMaterial({ color: 0x35415e });
    const g = new THREE.Group();
    // pivotTop verschiebt den Dreh­punkt nach oben (Schulter/Hüfte) → Arme & Beine
    // schwingen glaubhaft statt um ihre Mitte zu rotieren.
    const box = (w, h, d, m, x, y, z, pivotTop) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      if (pivotTop) geo.translate(0, -h / 2, 0);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    box(0.5, 0.72, 0.26, shirt, 0, 1.14, 0);                       // Torso
    box(0.46, 0.46, 0.46, skin, 0, 1.74, 0);                       // Kopf
    const legL = box(0.2, 0.72, 0.24, hose, -0.13, 0.76, 0, true); // Beine (Hüft-Pivot)
    const legR = box(0.2, 0.72, 0.24, hose, 0.13, 0.76, 0, true);
    const armL = box(0.16, 0.6, 0.2, skin, -0.33, 1.46, 0, true);  // Arme (Schulter-Pivot)
    const armR = box(0.16, 0.6, 0.2, skin, 0.33, 1.46, 0, true);
    // Namensschild als Sprite
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 48;
    const c2 = cv.getContext('2d');
    c2.font = 'bold 26px monospace';
    c2.textAlign = 'center';
    c2.fillStyle = 'rgba(0,0,0,0.45)';
    const tw = Math.min(250, c2.measureText(name).width + 18);
    c2.fillRect(128 - tw / 2, 4, tw, 38);
    c2.fillStyle = '#fff';
    c2.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    label.scale.set(2.4, 0.45, 1);
    label.position.y = 2.35;
    g.add(label);
    const start = pos ? { x: pos.x, y: pos.y, z: pos.z, yaw: pos.yaw || 0 } : { x: 0, y: 300, z: 0, yaw: 0 };
    g.position.set(start.x, start.y, start.z);
    this.ctx.scene.add(g);
    const rec = {
      name, mesh: g, buf: new SnapshotBuffer(INTERP_AVATAR), materials: [skin, shirt, hose], label,
      legs: [legL, legR], arms: [armL, armR], armR,
      walkPhase: 0, swing: 0, held: 0, heldMesh: null, flash: 0, dead: 0,
    };
    this.remote.set(id, rec); // Puffer füllt sich aus 'move'; bis dahin bleibt der Avatar an start
    if (pos && pos.held) this._setHeld(rec, pos.held);
  }

  // Gehaltenes Item in der rechten Hand des Avatars zeigen (schwingt mit dem Arm)
  _setHeld(rec, id) {
    id = id || 0;
    if (rec.held === id) return;
    rec.held = id;
    if (rec.heldMesh) { rec.armR.remove(rec.heldMesh); rec.heldMesh = null; } // Geometrie ist geteilt → nicht disposen
    const ents = this.ctx.entities;
    if (!id || id <= 0 || !ents) return;
    const mesh = new THREE.Mesh(ents._itemGeometry(id), ents._itemMat);
    mesh.scale.setScalar(1.5);
    mesh.position.set(0, -0.62, 0.14); // an der Hand (Armunterkante), leicht vor dem Körper
    mesh.rotation.set(0.3, 0, 0.35);
    rec.armR.add(mesh);
    rec.heldMesh = mesh;
  }

  _removeRemote(id) {
    const r = this.remote.get(id);
    if (!r) return;
    this.ctx.scene.remove(r.mesh);
    // Gehaltenes Item nutzt GETEILTE Item-Geometrie/Material → vorher abkoppeln,
    // damit der traverse-dispose sie nicht mit entsorgt (würde Drop-Items zerstören).
    if (r.heldMesh) { r.armR.remove(r.heldMesh); r.heldMesh = null; }
    r.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of r.materials) m.dispose();
    r.label.material.map.dispose();
    r.label.material.dispose();
    this.remote.delete(id);
  }

  update(dt) {
    if (!this.active) return;
    if (this._swingTimer > 0) this._swingTimer -= dt;
    // eigene Position ~10×/s senden
    this._moveTimer -= dt;
    if (this._moveTimer <= 0) {
      this._moveTimer = 0.05; // 20×/s senden → mehr Stützpunkte für die Interpolation
      const p = this.ctx.player;
      this._send({
        type: 'move',
        x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
        yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2),
        held: this.ctx.inventory?.selectedItem?.()?.id || 0, // gehaltenes Item für die Hand
        st: Math.round(performance.now()), // Sender-Zeitstempel für die Interpolation
      });
    }
    // Host: Mob-Snapshot ~8×/s an alle Gäste (nur wenn jemand zuschaut)
    if (this.isHost && this.remote.size > 0) {
      this._entsTimer -= dt;
      if (this._entsTimer <= 0) {
        this._entsTimer = 0.1; // 10×/s Mob-Snapshots → passt zum Interpolations-Puffer
        this._send({ type: 'ents', list: this.ctx.entities?.collectSnapshot() || [], st: Math.round(performance.now()) });
      }
    }
    // Spielstand alle 10 s auf dem Server sichern (Items, Position, Leben)
    this._pstateTimer -= dt;
    if (this._pstateTimer <= 0) {
      this._pstateTimer = 10;
      this._sendePstate();
    }
    // Avatare aus dem Interpolations-Puffer bewegen (ruckelfrei trotz Ping) + animieren
    const dtMs = dt * 1000;
    for (const r of this.remote.values()) {
      const m = r.mesh;
      const px = m.position.x, pz = m.position.z;
      const s = r.buf.advance(dtMs);
      if (s) {
        m.position.set(s.x, s.y, s.z);
        if (r.dead <= 0) m.rotation.y = s.yaw;
      }

      // Laufanimation aus der tatsächlichen Bewegung ableiten
      const speed = Math.hypot(m.position.x - px, m.position.z - pz) / Math.max(dt, 1e-4);
      r.walkPhase += dt * Math.min(speed, 6) * 2.4;
      const sw = Math.sin(r.walkPhase) * 0.5 * Math.min(1, speed);
      r.legs[0].rotation.x = sw;
      r.legs[1].rotation.x = -sw;
      r.arms[0].rotation.x = -sw * 0.6;
      // rechter Arm: ein Schlag-/Abbau-Schwung überschreibt das Laufpendel
      if (r.swing > 0) {
        r.swing -= dt;
        const t = 1 - Math.max(0, r.swing) / 0.3;
        r.arms[1].rotation.x = -Math.sin(t * Math.PI) * 1.9;
      } else {
        r.arms[1].rotation.x = sw * 0.6;
      }

      // Treffer-Blitz: kurz rot aufleuchten
      if (r.flash > 0) {
        r.flash -= dt;
        const on = r.flash > 0;
        for (const mat of r.materials) {
          mat.emissive.setHex(on ? 0xff3020 : 0x000000);
          mat.emissiveIntensity = on ? 0.6 : 0;
        }
      }

      // Tod: nach vorn umkippen, leicht einsinken, dann ausblenden
      if (r.dead > 0) {
        r.dead -= dt;
        m.rotation.z = Math.min(Math.PI / 2, m.rotation.z + dt * 4.5);
        m.scale.setScalar(0.5 + 0.5 * Math.max(0, r.dead / 1.2));
        if (r.dead <= 0) m.visible = false;
      }
    }
  }
}
