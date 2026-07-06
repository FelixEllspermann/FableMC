// Voxel raycast (Amanatides & Woo DDA). Skips air and water; unloaded chunks stop the ray.

import { BLOCK, BLOCKS, isLiquid } from './constants.js';

export function raycastVoxel(world, origin, dir, maxDist, stopAtFluid = false) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = dir.x !== 0 ? ((dir.x > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity;
  let tMaxY = dir.y !== 0 ? ((dir.y > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity;
  let tMaxZ = dir.z !== 0 ? ((dir.z > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let dist = 0;

  for (let i = 0; i < 256; i++) {
    const id = world.getBlock(x, y, z);
    if (id === -1) return null;
    // Wasserpflanzen zählen als Flüssigkeit, sind aber anvisierbar (abbaubar).
    // stopAtFluid (Eimer): auch an einer Flüssigkeit anhalten statt durchzugehen.
    if (id !== BLOCK.AIR && (!isLiquid(id) || BLOCKS[id]?.waterPlant || stopAtFluid)) {
      return {
        x, y, z, id, nx, ny, nz, dist,
        px: origin.x + dir.x * dist,
        py: origin.y + dir.y * dist,
        pz: origin.z + dir.z * dist,
      };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      dist = tMaxX; tMaxX += tDeltaX; x += stepX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      dist = tMaxY; tMaxY += tDeltaY; y += stepY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      dist = tMaxZ; tMaxZ += tDeltaZ; z += stepZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
    if (dist > maxDist) return null;
  }
  return null;
}
