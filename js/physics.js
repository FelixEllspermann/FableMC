// Shared voxel physics: gravity, axis-separated AABB collision, water buoyancy.
// Entities: {pos: Vector3 (feet center), vel: Vector3, width, height, onGround, inWater, fallDistance}

import { GRAVITY, BLOCK, isSolid, isLiquid, isLavaId, collisionBoxesOf } from './constants.js';

const EPS = 0.001;

export function aabbIntersectsBlock(pos, width, height, bx, by, bz) {
  const h = width / 2;
  return pos.x - h < bx + 1 && pos.x + h > bx &&
         pos.y < by + 1 && pos.y + height > by &&
         pos.z - h < bz + 1 && pos.z + h > bz;
}

export function entitiesOverlapBlock(entities, bx, by, bz) {
  for (const e of entities) {
    if (e.type === 'item') continue;
    if (aabbIntersectsBlock(e.pos, e.width, e.height, bx, by, bz)) return true;
  }
  return false;
}

function overlapsBox(pos, width, height, x0, y0, z0, x1, y1, z1) {
  const h = width / 2;
  return pos.x - h < x1 && pos.x + h > x0 &&
         pos.y < y1 && pos.y + height > y0 &&
         pos.z - h < z1 && pos.z + h > z0;
}

function aabbCollidesWorld(world, e) {
  const h = e.width / 2;
  const minX = Math.floor(e.pos.x - h), maxX = Math.floor(e.pos.x + h);
  const minY = Math.floor(e.pos.y), maxY = Math.floor(e.pos.y + e.height - EPS);
  const minZ = Math.floor(e.pos.z - h), maxZ = Math.floor(e.pos.z + h);
  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const boxes = collisionBoxesOf(world.getBlock(bx, by, bz));
        if (!boxes) continue;
        for (const b of boxes) {
          if (overlapsBox(e.pos, e.width, e.height,
            bx + b[0], by + b[1], bz + b[2], bx + b[3], by + b[4], bz + b[5])) return true;
        }
      }
    }
  }
  return false;
}

function collideAxis(world, e, axis, delta, stepUp = 0, wasOnGround = false) {
  if (delta === 0) return;
  e.pos[axis] += delta;
  const h = e.width / 2;
  const minX = Math.floor(e.pos.x - h), maxX = Math.floor(e.pos.x + h);
  const minY = Math.floor(e.pos.y), maxY = Math.floor(e.pos.y + e.height - EPS);
  const minZ = Math.floor(e.pos.z - h), maxZ = Math.floor(e.pos.z + h);

  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const boxes = collisionBoxesOf(world.getBlock(bx, by, bz));
        if (!boxes) continue;
        for (const b of boxes) {
          const x0 = bx + b[0], y0 = by + b[1], z0 = bz + b[2];
          const x1 = bx + b[3], y1 = by + b[4], z1 = bz + b[5];
          if (!overlapsBox(e.pos, e.width, e.height, x0, y0, z0, x1, y1, z1)) continue;
          if (axis === 'x' || axis === 'z') {
            // Auto-Step: niedrige Kanten (Teppich, Stufen, Treppen …) ohne Springen erklimmen
            if (stepUp > 0 && wasOnGround) {
              if (y1 - e.pos.y > 0 && y1 - e.pos.y <= stepUp + 0.001) {
                const oldY = e.pos.y;
                e.pos.y = y1 + EPS;
                if (!aabbCollidesWorld(world, e)) {
                  e._hitGround = true; // steht weiter „am Boden“
                  return;
                }
                e.pos.y = oldY;
              }
            }
            if (axis === 'x') {
              e.pos.x = delta > 0 ? x0 - h - EPS : x1 + h + EPS;
              e.vel.x = 0;
            } else {
              e.pos.z = delta > 0 ? z0 - h - EPS : z1 + h + EPS;
              e.vel.z = 0;
            }
          } else {
            if (delta > 0) {
              e.pos.y = y0 - e.height - EPS;
            } else {
              e.pos.y = y1 + EPS;
              e._hitGround = true;
            }
            e.vel.y = 0;
          }
          return; // resolved against nearest obstruction; substeps keep this safe
        }
      }
    }
  }
}

// Advances the entity by dt with gravity + collisions. Returns {landed, fallDistance}.
export function stepEntity(world, e, dt, opts = {}) {
  dt = Math.min(dt, 1 / 20);

  // safety net: never let NaN/Infinity propagate into positions or freeze the substep loop
  if (!isFinite(e.vel.x + e.vel.y + e.vel.z)) e.vel.set(0, 0, 0);

  // liquid state: sampled at feet+0.2 and body middle (Wasser UND Lava bremsen/tragen)
  const midY = e.pos.y + e.height * 0.5;
  const feetId = world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y + 0.2), Math.floor(e.pos.z));
  const midId = world.getBlock(Math.floor(e.pos.x), Math.floor(midY), Math.floor(e.pos.z));
  e.inWater = isLiquid(feetId) || isLiquid(midId);
  e.inLava = isLavaId(feetId) || isLavaId(midId);

  if (!opts.noGravity) {
    e.vel.y -= GRAVITY * (e.inWater ? 0.25 : 1) * dt;
  }
  if (e.inWater) {
    // vertical drag / terminal velocities in water
    if (e.vel.y < -3) e.vel.y = -3;
    if (e.vel.y > 4.5) e.vel.y = 4.5;
  } else if (e.vel.y < -60) {
    e.vel.y = -60;
  }

  const wasFalling = !e.onGround && e.vel.y < 0;
  if (wasFalling && !e.inWater) e.fallDistance += -e.vel.y * dt;
  if (e.inWater) e.fallDistance = 0;

  const wasOnGround = e.onGround;
  const stepUp = opts.stepHeight || 0;
  e.onGround = false;
  e._hitGround = false;

  // substeps prevent tunneling at high speeds (hard-capped so the loop can never freeze)
  const maxDelta = Math.max(Math.abs(e.vel.x), Math.abs(e.vel.y), Math.abs(e.vel.z)) * dt;
  const steps = Math.min(40, Math.max(1, Math.ceil(maxDelta / 0.4)));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    collideAxis(world, e, 'x', e.vel.x * sdt, stepUp, wasOnGround || e._hitGround);
    collideAxis(world, e, 'z', e.vel.z * sdt, stepUp, wasOnGround || e._hitGround);
    collideAxis(world, e, 'y', e.vel.y * sdt);
  }
  if (e._hitGround) e.onGround = true;

  let landed = false, fd = 0;
  if (e.onGround && e.fallDistance > 0) {
    landed = true;
    fd = e.fallDistance;
    e.fallDistance = 0;
  }
  return { landed, fallDistance: fd };
}
