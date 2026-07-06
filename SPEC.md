# Fable MC — Voxel Game Spec (Single Source of Truth)

Minecraft-like voxel game. Browser, Three.js (r185, vendored in `lib/`), plain ES modules,
**no build step**, no external assets (all textures procedural), no network requests.
UI strings are **German**. Code identifiers/comments English.

## Hard rules for every module
- ES module in `js/`. Import three as `import * as THREE from 'three'` (import map provided by index.html).
- Import shared config ONLY from `./constants.js` (already written — read it, it is canonical).
- Write ONLY the files assigned to you. Other modules are implemented in parallel against this spec —
  code strictly against the contracts below, never invent/rename exports.
- Modules that create DOM append their root element(s) to `document.body` and inject their own
  `<style>` tag (scoped class prefixes, e.g. `.inv-…`, `.hud-…`). `css/style.css` is only a base reset.
- No TypeScript syntax. No `Date.now()` for game logic timing (use accumulated `dt`); `performance.now()` ok for frame timing.
- Performance matters: no per-frame allocations in hot loops (reuse vectors), dispose GPU resources on unload.
- After writing, syntax-check each file: `node --check js/<file>.js` (package.json has `"type":"module"`).

## Game context object (`ctx`)
`main.js` creates one shared context and passes it to every constructor:

```js
ctx = {
  renderer, scene, camera,        // three.js basics (exist before any module constructor)
  seed,                           // integer world seed
  state: {                        // plain mutable object, exists first
    paused: false,                // pause menu open → simulation halted
    uiOpen: false,                // inventory open → sim runs, player input ignored
    dead: false,
    time: 0,                      // total elapsed game seconds (drives day/night, saved)
    gameStarted: false,
  },
  // filled by main.js in this construction order:
  sounds, textures,               // textures = result of createAtlas()
  world, daynight, entities, inventory, survival, player, save, ui,
}
```
**Rule:** a constructor may only use `renderer/scene/camera/seed/state/sounds/textures` plus anything
constructed before it (see order above). Everything else only inside methods called later (update/events).

## Coordinate & data conventions
- World coords: x/z horizontal, y up. Block at integer (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1).
- Chunk = 16×128×16 column. Chunk coords cx=floor(x/16), cz=floor(z/16). Key string: `"cx,cz"`.
- Chunk data: `Uint8Array(16*128*16)`, index via `blockIndex(lx,y,lz) = lx + lz*16 + y*256` (helper in constants.js).
- `world.getBlock(x,y,z)` returns block id; `0` = air; **`-1` = chunk not loaded** (callers: physics treats -1 as solid, raycast stops without hit, meshing must not run when a needed neighbor is -1).
- y<0 or y>=128 → returns `BLOCK.AIR` (never -1) except y<0 → returns `BLOCK.BEDROCK` (safety floor).
- Entity convention: `pos` is a `THREE.Vector3` at the **bottom-center (feet)** of the AABB;
  entity has `width` (x=z extent), `height`, `vel: Vector3`, `onGround: bool`, `inWater: bool`, `fallDistance: number`.

---

## File assignments & contracts

### A) `js/noise.js` + `js/worldgen.js`
`noise.js`:
```js
export function mulberry32(seed) → () => float [0,1)          // seedable PRNG
export function makeNoise2D(seed) → (x, z) => float [-1,1]     // Perlin or OpenSimplex, implement from scratch
export function makeNoise3D(seed) → (x, y, z) => float [-1,1]
export function fbm2(noiseFn, x, z, octaves, lacunarity, gain) → float ≈[-1,1]
export function hash2(seed, x, z) → float [0,1)                // fast deterministic per-column hash
```
`worldgen.js`:
```js
export function heightAt(seed, x, z) → integer   // terrain surface y (top solid block) at world column
export function biomeAt(seed, x, z) → 'plains'|'forest'|'desert'|'mountains'
export function generateChunkData(cx, cz, seed) → Uint8Array(32768)
export function findSpawn(seed) → {x, y, z}      // near (0,0), on land above SEA_LEVEL, y = surface+1
```
Terrain: fbm heightmap, base ≈ 44, hills ±10; separate low-freq "mountain" noise adds up to +45
(mountains biome where strong). Desert where low-freq temperature noise > 0.55 and not mountains: sand
top 3 layers, no trees. Otherwise grass + 3 dirt below, then stone. `SEA_LEVEL = 40` from constants:
fill air ≤ SEA_LEVEL with `WATER`; columns under water get sand top (beach: also sand when surface within
1 of sea level). Bedrock at y=0.
Caves: two 3D fbm noises n1,n2; carve air where `n1*n1+n2*n2 < 0.012` for `1 ≤ y ≤ surface-5`;
never carve blocks ≤ 3 blocks under a water column. Ores in stone: 3D noise/hash pockets — coal (y 5–70),
iron (y 5–40), roughly 0.8%/0.5% of stone.
Trees (forest density high, plains sparse): decided **deterministically per column** via `hash2(seed⊕k, x, z)`
< density, only if column surface is grass and above SEA_LEVEL+1. Trunk 4–6 logs (height from hash), leaves:
radius-2 blob for the top 2 trunk layers + radius-1 cap above, skip corners, never overwrite logs.
**Chunk-border correctness:** when generating chunk (cx,cz), evaluate tree columns in the range
[cx*16-2 … cx*16+17] × [cz*16-2 … cz*16+17] and write only the blocks that fall inside this chunk.
findSpawn: scan spiral from (0,0) for first non-desert land column with surface > SEA_LEVEL, return surface+1.

### B) `js/textures.js`
Procedural 16×16-px tile atlas on a canvas, 8×8 tiles (128×128 px), NearestFilter, generateMipmaps false, SRGBColorSpace.
```js
export function createAtlas() → {
  texture,                 // THREE.CanvasTexture of the atlas
  uv(tileName) → {u0,v0,u1,v1},   // uv rect for a tile (v axis three.js convention)
  tileIndex(tileName) → int,
}
export function getIconDataURL(id) → string   // 40×40 crisp PNG dataURL for block OR item id (cached Map)
```
Tile names required (painters for each, Minecraft-ish pixel art, use a seeded PRNG for speckle so it is
deterministic): `grass_top, grass_side, dirt, stone, cobblestone, log_top, log_side, planks, leaves,
sand, water, bedrock, coal_ore, iron_ore, crafting_table_top, crafting_table_side, stick,
wooden_pickaxe, wooden_axe, wooden_shovel, wooden_sword, stone_pickaxe, stone_axe, stone_shovel,
stone_sword, porkchop, rotten_flesh, apple, coal, raw_iron`.
Block/item → tile mapping comes from `BLOCKS[id].tiles` / `ITEMS[id].tile` in constants.js.
`leaves` tile must contain fully transparent pixels (alphaTest cutout); `water` tile is painted opaque-ish
(material handles transparency). Item tiles (tools etc.) drawn with transparent background.
getIconDataURL: blocks → draw their `side` (grass: side) tile upscaled without smoothing; items → their tile.

### C) `js/world.js` (+ you may add `js/chunkmesh.js` if you want the mesher separate)
```js
export class World {
  constructor(ctx)                        // uses ctx.scene, ctx.seed, ctx.textures
  getBlock(x,y,z) → id | -1
  setBlock(x,y,z,id)                      // player edit: updates data, records edit, queues remesh (+ neighbor chunks if on border)
  isLoaded(x,z) → bool
  surfaceY(x,z) → int | -1                // highest non-air, from loaded data
  update(dt, playerPos)                   // chunk streaming + budgets (see below)
  getEdits() → plain object {"cx,cz": {idxString: id}}   // all recorded edits, for save
  applyEdits(editsObj)                    // called before/while chunks generate (store; merge into chunks on generation)
  chunkCount → int                        // for debug HUD
  dispose()
}
```
Streaming per `update`: ensure chunks with chebyshev distance ≤ GENERATE_DISTANCE from player chunk have
data (generate max 2 per frame, nearest first); mesh chunks ≤ RENDER_DISTANCE whose 4 neighbors have data
(mesh max 2 per frame, nearest first; also process dirty/remesh queue first); unload (remove meshes,
dispose geometry, drop data) beyond UNLOAD_DISTANCE. Edits from `applyEdits` must survive unload/reload
(they are merged again on regeneration).
Meshing (per chunk, one pass over voxels, no greedy needed):
- Two meshes per chunk: **solid** (all opaque + leaves) and **water**.
- Solid material (create ONCE, share): `MeshLambertMaterial({map: atlas, vertexColors: true, alphaTest: 0.5})`.
- Water material: `MeshLambertMaterial({map: atlas, transparent: true, opacity: 0.72, depthWrite: false, side: DoubleSide})`.
- Emit a face when neighbor is air / water (for solid) / not water (for water faces: only when neighbor is air).
  Neighbor -1 (unloaded) → do NOT emit (mesher only runs when neighbors loaded; y out of range → treat as air, y<0 solid).
- Leaves: also emit faces between leaves and leaves? No — treat leaves like opaque for culling (cheap), but DO emit solid faces adjacent to leaves (so ground under trees isn't holey): rule = emit face if neighbor is AIR, WATER, or LEAVES (and self ≠ neighbor type for leaves-leaves? emit leaves-leaves too — looks fuller: simply: neighbor is non-opaque per `BLOCKS[n].opaque === false`).
- Water top surface at y+0.9 instead of y+1 when block above is not water.
- UVs per face from `BLOCKS[id].tiles` {top,side,bottom}. 
- Vertex AO: classic 3-neighbor rule (side1, side2, corner → occlusion 0–3), bake as vertex color
  grey `1 - 0.22*occ`; flip quad diagonal when needed (standard AO flip) to avoid anisotropy.
- BufferGeometry with position/normal/uv/color + index; `computeBoundingSphere()`; `mesh.frustumCulled = true`;
  `matrixAutoUpdate = false` after positioning at (cx*16, 0, cz*16); local coords inside.

### D) `js/physics.js` + `js/raycast.js` + `js/player.js`
`physics.js`:
```js
export function stepEntity(world, e, dt, opts = {}) → {landed: bool, fallDistance: number}
// applies gravity (GRAVITY, reduced to 25% + vertical drag when e.inWater),
// axis-separated AABB-vs-voxel collision (x, then z, then y), sets e.onGround/inWater,
// tracks e.fallDistance (reset in water / on ground; `landed` true on ground contact this step).
// opts: {noGravity: bool}. Treat getBlock -1 as solid. Clamp dt internally (max 1/20 s).
export function aabbIntersectsBlock(pos, width, height, bx, by, bz) → bool
export function entitiesOverlapBlock(entitiesArr, bx,by,bz) → bool  // used to block placement
```
`raycast.js`:
```js
export function raycastVoxel(world, origin, dir, maxDist) → null |
  {x,y,z, id, nx,ny,nz, dist, px,py,pz}   // Amanatides-&-Woo DDA; skips WATER and AIR; -1 stops → null
```
`player.js`:
```js
export class Player {
  constructor(ctx)   // sets up keyboard/mouse listeners on document / renderer.domElement
  pos, vel, onGround, inWater, width=PLAYER.WIDTH, height=PLAYER.HEIGHT
  target             // current raycastVoxel result (or null), updated every frame
  update(dt)
  respawnAt(x,y,z)
  serialize() → {pos:[x,y,z], yaw, pitch}    // for save
  restore(data)
}
```
Behavior: pointer-lock look (yaw/pitch, clamp pitch ±89°); WASD relative to yaw; Space = jump
(vel.y = JUMP_SPEED, only onGround) / swim up when inWater; Ctrl or double-tap-W = sprint (speed
SPRINT_SPEED, FOV lerps 75→84); Shift = sneak speed. Ignore ALL input & mining when
`state.paused || state.uiOpen || state.dead`. Camera: `camera.position = pos + (0, EYE_HEIGHT, 0)`,
small view-bob optional. Movement uses acceleration toward wish-velocity (ground accel high, air low),
then `stepEntity`. On `landed` with fallDistance > 3 → `ctx.survival.damage(floor(fallDistance-3), 'fall')`.
- Every frame: `this.target = raycastVoxel(world, eyePos, viewDir, REACH)`.
- **Left mouse down:** first `ctx.entities.raycast(eyePos, viewDir, REACH-1)` → if entity hit:
  `ctx.entities.hurt(entity, heldDamage, knockDir)` (attack cooldown 0.4s). Else mine `target`:
  accumulate progress while held on same block; time = `miningTime(blockId, heldItemId)` helper using
  BLOCKS hardness + ITEMS tool speedMult (see constants); `ctx.ui.setMiningProgress(0..1)`; on completion:
  `world.setBlock(x,y,z,0)`, `ctx.sounds.blockBreak()`, drop: `ctx.entities.spawnItemDrop(x+.5,y+.5,z+.5, dropId, 1)`
  (drop rules in constants: BLOCKS[id].drops, apple chance for leaves; **no drop** if block requires higher
  tool level than held — `BLOCKS[id].harvestLevel > toolLevel(held)`). Unbreakable (hardness<0): no mining.
- **Right mouse:** if target block is CRAFTING_TABLE → `ctx.inventory.open(true)`. Else if held is food →
  hold-to-eat 1.2s then `ctx.survival.eat(food)` + consume item. Else if held is a block id → place at
  target adjacent cell (x+nx, y+ny, z+nz) if `getBlock` there is AIR or WATER, and NOT
  `aabbIntersectsBlock(player)/entitiesOverlapBlock(mobs)`: `world.setBlock(...)`, consume 1 from
  hotbar (`ctx.inventory`), `ctx.sounds.blockPlace()`.
- Hotbar: keys 1–9 and wheel → `ctx.inventory.setHotbarIndex(i)`.
- Held item id: `ctx.inventory.selectedItem()?.id ?? null`.

### E) `js/inventory.js` + `js/crafting.js`
`crafting.js`:
```js
export const RECIPES   // see list below
export function matchGrid(gridIds, w, h) → null | {id, count}
// gridIds: array w*h of item/block ids (0 = empty), row-major. Shaped matching: trim empty
// rows/cols, compare against pattern AND its horizontal mirror. Shapeless recipes match by multiset.
```
Recipes: log→4 planks (shapeless); 2 planks stacked vertically→4 sticks; 4 planks in 2×2→crafting table;
tools (3×3 only — pattern P=planks or C=cobblestone, S=stick): pickaxe `PPP/.S./.S.`,
axe `PP./PS./.S.` (+mirror), shovel `.P./.S./.S.` (accept as 1×3 col P,S,S after trim), sword `.P./.P./.S.`
(1×3 P,P,S). Wooden (planks) and stone (cobblestone) variants → respective tool ids.
`inventory.js`:
```js
export class Inventory {
  constructor(ctx)          // builds hotbar HUD (always visible) + inventory screen (hidden), injects styles
  slots                     // Array(36): {id, count} | null. 0–8 = hotbar, 9–35 = main
  hotbarIndex
  setHotbarIndex(i)
  selectedItem() → {id,count}|null
  addItem(id, count) → leftover   // stack to existing (max stackSize from ITEMS/BLOCKS, tools 1), then empty slots; updates UI
  consumeSelected(n=1)
  open(withTable=false)     // withTable → 3×3 craft grid, else 2×2; sets state.uiOpen=true, releases pointer lock
  close()                   // returns crafting-grid items to inventory (or drop via ctx.entities if full); state.uiOpen=false
  isOpen
  serialize() / restore(data)
}
```
UI (German): key **E** toggles (also Esc closes when open — stopPropagation so pause menu doesn't trigger).
Grid layout: crafting area (2×2 or 3×3 + „→" + result slot) on top, 27-slot main grid, 9-slot hotbar row.
Icons via `ctx.textures.getIconDataURL(id)`, count badge bottom-right, name tooltip on hover (title attr ok).
Cursor stack model: click slot = pick up stack / place / swap; right-click = place one (or pick up half when
cursor empty); cursor stack rendered as element following the mouse. Result slot: click collects result and
consumes 1 from each grid slot (re-match after). Crafting grid re-matched on every change via `matchGrid`.
Hotbar HUD bottom-center always visible, selected slot highlighted; re-render on any change.

### F) `js/entities.js` — mobs + item drops
```js
export class EntityManager {
  constructor(ctx)
  list                       // all entities
  update(dt)                 // AI, physics via stepEntity, spawning/despawning, pickup, day-burn
  spawnItemDrop(x,y,z, id, count)
  raycast(origin, dir, maxDist) → null | {entity, dist}    // ray vs entity AABBs, nearest
  hurt(entity, dmg, knockbackDir)   // 0.5s invulnerability per entity, red flash, knockback (≈ +6 horiz, +5 up on vel)
  count → int                // for debug HUD
  dispose()
}
```
Entities are plain objects `{type, pos, vel, width, height, onGround, inWater, fallDistance, health, mesh, ...}`
using `stepEntity` from physics.js for movement.
- **Pig** (`type:'pig'`): hp 10, wanders (pick random direction 2–5s, pauses), speed 1.4; when hurt → flee
  at 3.5 for 5s. Death → drop 1–2 `ITEM.PORKCHOP`. Mesh: THREE.Group of boxes (body, head w/ snout, 4 legs),
  pink Lambert materials, simple leg swing while moving, faces movement direction.
- **Zombie** (`type:'zombie'`): hp 20, speed 2.3; if player dist < 20 → chase (horizontal steer toward player,
  jump when onGround && blocked horizontally); within 1.4 of player → `ctx.survival.damage(3,'zombie')`,
  cooldown 1.0s. During daytime (`ctx.daynight.isNight() === false`): take 1 dmg/s (burning). Death → 0–2
  `ITEM.ROTTEN_FLESH`. Mesh: green boxes humanoid (head, body, 2 arms stretched forward, 2 legs), leg/arm swing.
- Mob fall damage like player (floor(fall-3)). Mobs die → small shrink/fall-over tween then remove.
- **Spawning:** every 2s attempt: pigs (day, on grass, max PIG_CAP within 64m, ring 20–40m around player,
  surface via `world.surfaceY`); zombies (night only, max ZOMBIE_CAP, same ring, surface). Despawn > 64m.
- **ItemDrop** (`type:'item'`): 0.28-size cube (or flat quad for items) textured with its tile via atlas uv
  (clone geometry w/ adjusted UVs or small canvas texture from `getIconDataURL`), bob+spin, physics with
  gravity; after 0.5s pickup delay: if player dist < 1.8 fly toward player, < 0.6 → `ctx.inventory.addItem`
  (leftover stays), `ctx.sounds.pickup()`. Lifetime 180s. Merge not required.

### G) `js/survival.js` + `js/daynight.js` + `js/sounds.js`
`survival.js`:
```js
export class Survival {
  constructor(ctx)        // builds hearts + hunger + air-bubble DOM (over hotbar), damage vignette overlay
  health (0–20), hunger (0–20)
  damage(amount, cause)   // red vignette flash, ctx.sounds.hurt(), death handling
  eat(foodValue)          // hunger += value (cap 20), ctx.sounds.eat()
  update(dt)
  serialize() / restore(data)
}
```
Hunger: exhaustion accumulator — sprinting +0.1/s, jump +0.2, mining tick +0.005, attack +0.3, regen tick +3;
every 4.0 exhaustion → hunger −1. Regen: hunger ≥ 18 && health < 20 → +1 health / 4s. Starvation:
hunger == 0 → 1 dmg/4s down to min health 1. Drowning: eye block is WATER → air 10→0 over 10s, then
1 dmg/s; air bubbles UI (10 icons) visible only when submerged/refilling. Death: health ≤ 0 →
`state.dead = true`, death overlay „Du bist gestorben" + button „Respawn" → restore health/hunger/air,
`ctx.player.respawnAt(spawn)` (spawn from `findSpawn(ctx.seed)` — import from worldgen), `state.dead=false`.
Hearts UI: 10 hearts (half-heart granularity), hunger: 10 drumsticks, both simple inline-SVG or unicode-styled
divs — crisp, Minecraft-ish placement above hotbar (left: hearts, right: hunger).
`daynight.js`:
```js
export class DayNight {
  constructor(ctx)   // adds DirectionalLight (sun), AmbientLight, sky background, fog to scene
  update(dt)         // advances state.time (dt), unless state.paused
  isNight() → bool
  dayFraction → 0..1 // 0 = sunrise, .25 noon, .5 sunset, .75 midnight
}
```
`dayFraction = (state.time % DAY_LENGTH) / DAY_LENGTH`. Sun orbits (elevation = sin(f*2π)); directional
light intensity 0→1 with sun elevation, warm at low sun; ambient 0.25 night → 0.55 day; sky color lerp via
key colors (day #87CEEB, sunset #fda65e, night #0b0e1a); `scene.fog = new THREE.Fog(skyColor, RD*16*0.55, RD*16*0.95)`
updated to match sky; night = elevation < −0.08. Optional: simple sun/moon quad + star Points at night.
`sounds.js`:
```js
export const Sounds = { init(), blockBreak(), blockPlace(), hurt(), eat(), pickup(), jump(), splash() }
```
Procedural WebAudio (lazy AudioContext on first user gesture — call init() from a click handler in main):
short filtered-noise bursts for break/place/splash, descending saw blip for hurt, crunchy repeated noise for
eat, rising sine blip for pickup. Master gain ≈ 0.18. Every function no-ops safely before init.

### H) `js/save.js` + `js/ui.js`
`save.js`:
```js
export class SaveManager {
  constructor(ctx)
  static hasSave() → bool
  static readMeta() → {seed} | null      // static, callable before world exists
  load() → savedObj | null               // full parse
  save()                                 // collects: seed, state.time, world.getEdits(), player.serialize(), survival.serialize(), inventory.serialize()
  startAutosave()                        // every 15s + on beforeunload/visibilitychange(hidden)
  static clear()
}
```
localStorage key `"fablemc.save.v1"`, JSON. Restoring is orchestrated by main.js (calls world.applyEdits,
player.restore, etc.) — save.js just persists/parses. Handle QuotaExceeded gracefully (console.warn).
`ui.js`:
```js
export class UI {
  constructor(ctx)               // crosshair, mining ring, debug overlay, pause menu, title screen DOM
  showTitle() → Promise<{mode: 'new'|'load', seed}>   // resolves when user clicks start
  setMiningProgress(p)           // 0 hides, 0<p<=1 shows radial/бar progress near crosshair
  showPause() / hidePause()
  update(dt)                     // debug overlay refresh (2×/s)
  toast(text)                    // small fading message (optional use)
}
```
- **Title screen** (German): big title „Fable MC", seed input (placeholder „Seed (leer = zufällig)"),
  buttons „Neue Welt" and „Welt fortsetzen" (disabled/hidden when `SaveManager.hasSave()` false),
  „Welt löschen" (confirm, then `SaveManager.clear()`), plus a controls legend
  (WASD Bewegen · Leertaste Springen · Strg Sprinten · Linksklick Abbauen/Angreifen · Rechtsklick
  Platzieren/Essen/Interagieren · E Inventar · 1–9/Mausrad Hotbar · F3 Debug · Esc Pause). Style: dark
  overlay, blocky pixel font (font-family monospace, text-shadow), fits mobile-ish widths.
- **Pause:** main.js calls showPause when pointer lock is lost while game running & !uiOpen & !dead;
  buttons „Weiterspielen" (re-request pointer lock via callback ctx-provided), „Speichern" (ctx.save.save(),
  toast „Gespeichert"), sets `state.paused`. hidePause clears it.
- **Debug (F3 toggle):** fps (smoothed), pos x/y/z (1 decimal), chunk count (`world.chunkCount`), entities
  (`entities.count`), time of day (HH:MM from dayFraction), seed.
- Crosshair: centered +. Mining progress: small circular arc (canvas or conic-gradient div) at center.

### I) `js/main.js` — written LAST by the integrator
Boot: base three setup (renderer w/ antialias:false, sRGB output default, shadow off; PerspectiveCamera 75°,
near .1, far 1000; Scene), `Sounds` + `createAtlas()`, ctx assembly in the construction order above,
`ui.showTitle()` → seed = parsed input | hash of random words | from save meta; if mode 'load' →
`save.load()` and orchestrate restores (world.applyEdits BEFORE first world.update; player.restore;
survival/inventory restore; state.time). Else: `findSpawn(seed)` → player.respawnAt. Pregenerate: run
world.update in a small loop (or a few frames with a „Welt wird generiert…" overlay) until spawn chunks
ready, then start. Pointer lock: click on canvas requests lock (when !uiOpen && !dead); `pointerlockchange`
→ lost & running → ui.showPause. Fixed-timestep loop: accumulator, `STEP = 1/60`, max 4 steps/frame:
each step (unless paused): player.update, entities.update, survival.update; each frame: world.update(dt, player.pos),
daynight.update, ui.update, render. Resize handler. `window.__game = ctx` for debugging.

---

## Definition of done (all agents)
- No console errors; `node --check` passes on your files.
- Contracts above implemented exactly (names, signatures, semantics).
- German user-facing strings; no placeholder/"TODO" stubs — everything you own must actually work.
