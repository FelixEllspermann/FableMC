// Persistent game settings (localStorage). Values are read live by the systems.

const KEY = 'fablemc.settings.v1';

export const Settings = {
  renderDistance: 8,  // chunks; 5..36 (voxel detail up to VOXEL_DETAIL_CAP, beyond that far-terrain)
  creativeSpeed: 1,   // movement multiplier in creative mode, 1..3

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && typeof d.renderDistance === 'number') {
        this.renderDistance = Math.min(36, Math.max(5, d.renderDistance | 0));
      }
      if (d && typeof d.creativeSpeed === 'number') {
        this.creativeSpeed = Math.min(3, Math.max(1, d.creativeSpeed));
      }
    } catch { /* defaults */ }
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        renderDistance: this.renderDistance,
        creativeSpeed: this.creativeSpeed,
      }));
    } catch { /* ignore */ }
  },
};

Settings.load();
