# Fable MC — Mehrspieler-Anleitung

Gemeinsame Welt für mehrere Spieler: geteilte Block-Änderungen, Truhen, Uhrzeit,
Spieler-Avatare mit Namen, Chat — und **geteilte Monster, Tiere & Events**
(Stufe 2). Der Server speichert die Welt automatisch.

## 1. Einmalig vorbereiten

```powershell
cd "D:\Fable MC"
npm install
```

Das installiert die WebSocket-Bibliothek (`ws`). Node.js muss installiert sein.

## 2. Server starten — der einfache Weg: Steuerzentrale

**Doppelklick auf `Fable MC.bat`** (im Projektordner). Es öffnet sich die
**Steuerzentrale** im Browser — ein kleines Menü, *bevor* der Server startet:

- **Server-Port** einstellen (Standard **8123** — das ist der Port fürs
  Port-Forwarding; jeder andere Port geht auch)
- **Welt auswählen** aus deinen gespeicherten Welten und mit **▶ Starten** loslegen
- oder eine **neue Welt** anlegen (Name + Seed; Seed leer = zufällig)
- danach zeigt das Fenster **Live-Infos**: Spieler online mit Position, Laufzeit,
  Seed, Spielzeit und ein laufendes Server-Protokoll
- pro Spieler Knöpfe **Kick** (rauswerfen) und **Bann** (dauerhaft, per IP)
- Knöpfe zum **Stoppen** und **Neustarten** des Servers
- Reiter **Bans**: alle gebannten IPs mit den je benutzten Namen und **Entbannen**

Das Fenster (die schwarze Konsole) offen lassen — sie schließen beendet den Server.
Jede Welt liegt als eigene Datei im Ordner **`worlds/`**. Eine vorhandene
`world-mp.json` wird beim ersten Start automatisch als „Hauptwelt" übernommen.

> Die Steuerzentrale läuft nur lokal (Port **8130**, nur von deinem PC
> erreichbar), der Spielserver auf dem eingestellten Port (Standard **8123**).
> Andere Ports beim Start: `node launcher.js --port 8130 --gameport 8123`.

### Spielerstände & Kick/Bann

- **Jeder Spieler behält seinen Fortschritt.** Server merkt sich pro **IP + Name**
  Inventar, Position und Leben. Beim Wiederverbinden bist du genau da, wo du warst
  — mit denselben Items. So hat auch jeder Mitspieler seinen eigenen Stand.
- **Kick** wirft einen Spieler nur einmal raus (er kann sofort wieder rein).
- **Bann** sperrt die **IP-Adresse** dauerhaft (auch alle Zweit-Namen davon).
  Gebannte kommen gar nicht mehr rein. Bans überstehen Server-Neustarts
  (gespeichert in `bans.json`). Entbannen geht im Reiter **Bans**.
- Kick/Bann/Entbannen erreicht **nur du** (die Steuerzentrale ist auf deinen PC
  beschränkt) — kein Mitspieler kann darauf zugreifen, selbst bei Port-Forwarding.

## 2b. Server starten — der manuelle Weg (ohne Steuerzentrale)

```powershell
npm run mp
```

Der Server läuft dann auf **Port 8123** und zeigt beim Start den Seed an.
Optionen:

```powershell
node server.js --port 9000                 # anderer Port
node server.js --welt "worlds/meine.json"  # bestimmte Weltdatei laden
node server.js --seed 42                    # bestimmter Seed (nur für neue Welten)
```

Ohne `--welt` wird die Welt in **`world-mp.json`** neben `server.js` gespeichert
(alle 30 s und beim Beenden mit Strg+C). Die jeweilige Weltdatei sichern = Welt sichern.

## 3. Beitreten

1. Browser öffnen: `http://localhost:8123` (du selbst) bzw. die Adresse des Hosts
2. Am Titelbildschirm **Spielernamen** eingeben
3. **„Mehrspieler beitreten"** klicken — das Feld „Server-Adresse" bleibt leer,
   wenn das Spiel schon vom Mehrspieler-Server geladen wurde

**Chat:** Taste **T** öffnet den Chat, **Enter** sendet, **Esc** schließt.

## 4. Mit Freunden spielen

### Im selben Netzwerk (LAN)
1. Deine lokale IP herausfinden: `ipconfig` → „IPv4-Adresse" (z. B. `192.168.1.42`)
2. Freunde öffnen im Browser: `http://192.168.1.42:8123`
3. Beim ersten Start fragt die **Windows-Firewall** — „Zugriff zulassen" für Node.js wählen

### Über das Internet (Port-Forwarding)
1. Im Router ein **Port-Forwarding** einrichten: externer Port **8123** (TCP) →
   interne IP deines PCs, Port **8123**
   (Router-Oberfläche meist unter `192.168.1.1` oder `fritz.box`)
2. Deine öffentliche IP herausfinden (z. B. wieistmeineip.de)
3. Freunde öffnen: `http://DEINE-ÖFFENTLICHE-IP:8123`

Hinweise:
- Die meisten Heimanschlüsse bekommen regelmäßig neue IPs — bei Bedarf einen
  DynDNS-Dienst im Router einrichten (z. B. myfritz, duckdns).
- **Alternative ohne Router-Konfiguration:** Tunnel-Dienste wie
  [playit.gg](https://playit.gg) oder ein gemeinsames [Tailscale](https://tailscale.com)-Netz
  leiten den Port durch, ohne dass du am Router etwas ändern musst.

### Auf einem Mietserver (VPS)
Projektordner hochladen, `npm install`, dann z. B.
`node server.js --port 80 --seed 42`. Freunde verbinden auf `http://SERVER-IP`.

## 5. Was geteilt wird — und wie

**Geteilt:** Seed & Welt, alle Block-Änderungen (bauen, abbauen, Türen, Explosionen,
gewachsene Bäume …), Truhen-Inhalte (auch Beute-Truhen — wer zuerst öffnet, würfelt
die Beute für alle), Uhrzeit (Bett-Schlaf springt für alle zum Morgen), Chat,
Spieler-Positionen — und seit **Stufe 2** auch:

- **Monster & Tiere:** Alle sehen dieselben Mobs an denselben Orten. Mobs greifen
  den **nächsten** Spieler an (auch Mitspieler), Skelett-Pfeile und Explosionen
  treffen jeden. Mobs erscheinen um alle Spieler herum, nicht nur um einen.
- **Kämpfen im Team:** Jeder kann jeden Mob schlagen — Schaden, Rückstoß und
  rotes Aufblitzen sehen alle. Auch Schafe scheren geht bei geteilten Schafen.
- **Mob-Beute:** Drops (Fleisch, Wolle, Knochen, Schießpulver …) erscheinen für
  alle Spieler. Jeder kann sie einsammeln — die Beute ist bewusst großzügig
  (jeder Client bekommt sein eigenes Exemplar).
- **Dschungeltempel-Event:** Löst ein Mitspieler die versiegelte Truhe aus,
  spawnen die Wellen um **ihn** herum und alle können mitkämpfen. Ist die Truhe
  entsiegelt, sehen das alle.
- **Monster-Spawner** in Dungeons laufen zentral — kein doppeltes Gewusel.
- **Spielerstände:** Der Server merkt sich pro **IP + Name** dein Inventar, deine
  Position und dein Leben. Beim Wiederverbinden landest du am selben Stand.

**So funktioniert es (Host-Prinzip):** Der **erste Spieler** auf dem Server ist
der „Host" — sein Browser simuliert Monster, Events und Spawner und schickt allen
anderen ~8×/s den Zustand. Verlässt der Host das Spiel, übernimmt automatisch
der nächste Spieler (kurzes Aufploppen „👑 Du bist jetzt der Host"). Die Mobs
starten dann frisch — die Welt selbst bleibt natürlich erhalten.

**Weiterhin clientlokal:** Flüssigkeits-Simulation und fallender Sand/Kies
(laufen deterministisch aus den geteilten Block-Änderungen), Partikel. Kein PvP —
Spieler können einander nicht direkt schlagen (Explosionen sind die Ausnahme:
Vorsicht mit TNT!). Dein Inventar wird jetzt **serverseitig pro IP + Name**
gesichert (siehe „Spielerstände & Kick/Bann" oben).

**Kleine Stufe-2-Grenzen:** Zündet ein Gast TNT, sehen andere zwar Krater und
Schaden, aber nicht den blinkenden TNT-Block selbst. Mobs spawnen nur in
Weltbereichen, die der Host geladen hat — wer sehr weit weg vom Host spielt,
sieht weniger Monster.

## 6. Häufige Probleme

| Problem | Lösung |
| --- | --- |
| „Verbindung fehlgeschlagen" | Läuft der Server (Steuerzentrale / `npm run mp`)? Richtiger Port? Firewall? |
| Freunde kommen nicht drauf (Internet) | Port-Forwarding prüfen; Anbieter mit DS-Lite (kein echtes IPv4) → Tunnel-Dienst nutzen |
| Welt zurücksetzen | In der Steuerzentrale die Welt löschen (oder ihre Datei in `worlds/` entfernen) |
| Anderer Seed gewünscht | Neue Welt in der Steuerzentrale anlegen (Name + Seed) |
| Spieler entbannen | Steuerzentrale → Reiter **Bans** → **Entbannen** (oder `bans.json` bearbeiten) |
| Spielstand eines Spielers zurücksetzen | Server stoppen, in der Weltdatei unter `players` den Eintrag `"IP\|Name"` löschen |
