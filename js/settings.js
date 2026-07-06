// Persistent game settings (localStorage). Values are read live by the systems.

const KEY = 'fablemc.settings.v1';

export const Settings = {
  renderDistance: 8,  // chunks; 5..36 (voxel detail up to VOXEL_DETAIL_CAP, beyond that far-terrain)
  creativeSpeed: 1,   // movement multiplier in creative mode, 1..3
  lang: 'de',         // Menüsprache: 'de' | 'en'
  clouds: true,       // Wolken am Himmel anzeigen
  maxFps: 0,          // Bild-Obergrenze; 0 = unbegrenzt (nur wirksam bei vsync=false)
  vsync: true,        // an die Bildwiederholrate des Monitors koppeln (ignoriert maxFps)

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && typeof d.renderDistance === 'number') {
        this.renderDistance = Math.min(36, Math.max(5, d.renderDistance | 0));
      }
      if (d && typeof d.creativeSpeed === 'number') {
        this.creativeSpeed = Math.min(3, Math.max(1, d.creativeSpeed));
      }
      if (d && (d.lang === 'de' || d.lang === 'en')) {
        this.lang = d.lang;
      }
      if (d && typeof d.clouds === 'boolean') this.clouds = d.clouds;
      if (d && typeof d.maxFps === 'number') this.maxFps = Math.max(0, Math.min(1000, d.maxFps | 0));
      if (d && typeof d.vsync === 'boolean') this.vsync = d.vsync;
    } catch { /* defaults */ }
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        renderDistance: this.renderDistance,
        creativeSpeed: this.creativeSpeed,
        lang: this.lang,
        clouds: this.clouds,
        maxFps: this.maxFps,
        vsync: this.vsync,
      }));
    } catch { /* ignore */ }
  },
};

Settings.load();
