// Drawing a level, and walking around it.
//
// The art is 8-bit: every texture is palette indices, turned to RGBA here
// once. Walls are batched by tile so the whole level is a handful of draw
// calls.

import {DIM, TILE, walls, planesMesh, wallLump, flat, solidMap, storeysOf,
        levelInfo, spawnOf, doors, doorFace, maskWalls, platforms,
        platformWalls, platformLumpName, props, propLumpName,
        spriteScale} from './level.js';
import {patchIndexed} from './wad.js';

const RADIUS = 22;          // the player's half-width, as the exporter has it
const EYE = 39;             // z + playerheight in ROTT's own terms
const DOOR_SPEED = 35 / 16; // 1<<12 of 0x10000 a tic: open in 16 tics
const OPENTICS = 165 / 35;  // how long it stands open before closing again

// Column-major palette indices -> an RGBA texture. ROTT stores its art in
// columns; the canvas wants rows.
//
// Row 0 of a DataTexture is v=0, the BOTTOM of the quad, and three.js does
// not honour flipY here (see ../ROTT's idxTexture, which hit this first) --
// so the image is written out bottom-up rather than top-down, or every wall,
// flat, door and masked-wall texture comes out upside down.
function texture(THREE, bytes, w, h, pal, colMajor = true, mask = null) {
  const rgba = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = colMajor ? x * h + y : y * w + x;
      const p = bytes[i] * 3, o = ((h - 1 - y) * w + x) * 4;
      rgba[o] = pal[p]; rgba[o + 1] = pal[p + 1]; rgba[o + 2] = pal[p + 2];
      rgba[o + 3] = mask ? mask[i] : 255;
    }
  }
  const t = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Both sides, everywhere: a wall seen from inside a solid block and a floor
// seen from below are not worth the winding rules they would cost.
function material(THREE, opts) {
  return new THREE.MeshBasicMaterial(Object.assign({side: THREE.DoubleSide}, opts));
}

const UVBOX = [[0, 0], [1, 0], [1, 1], [0, 1]];
// Top and bottom swapped: ../ROTT's uvq for a flipped masked-wall piece
// (platform_pieces' bottom/above flip -- see level.js's PLATFORM_PIECES).
const UVBOX_FLIP = [[0, 1], [1, 1], [1, 0], [0, 0]];
function quad(g, pts, uv) {
  for (const i of [0, 1, 2, 0, 2, 3]) {
    g.pos.push(pts[i][0], pts[i][1], pts[i][2]);
    g.uv.push(uv[i][0], uv[i][1]);
  }
}

function mesh(THREE, geo, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(geo.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uv, 2));
  return new THREE.Mesh(g, mat);
}

export class Level {
  constructor(THREE, canvas, wad, planes) {
    this.THREE = THREE;
    const [p0, p1, p2] = planes;
    this.p0 = p0;
    this.storeys = storeysOf(p1);
    // Static platforms first: their footprint has to reach solidMap and
    // walls before either runs, or the plane-0 21 under each one reads as an
    // ordinary wall and seals the platform off. See level.js's platforms.
    const plats = platforms(p0, p1, p2);
    const platset = new Set(plats.map((q) => q.y * DIM + q.x));
    this.solid = solidMap(p0, platset);
    this.info = levelInfo(p0);
    const pal = wad.pal;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 1, 9000);
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    this.renderer.setPixelRatio(devicePixelRatio);

    for (const [tile, geo] of walls(p0, this.storeys, platset)) {
      const lump = wallLump(wad, tile);
      const mat = lump
        ? material(THREE, {map: texture(THREE, lump, 64, 64, pal)})
        : material(THREE, {color: 0x555a66});
      this.scene.add(mesh(THREE, geo, mat));
    }

    const fl = planesMesh(this.storeys);
    const floorTex = flat(wad, this.info.floor);
    this.scene.add(mesh(THREE, fl.floor, floorTex
      ? material(THREE, {map: texture(THREE, floorTex, 128, 128, pal)})
      : material(THREE, {color: 0x2a2d36})));
    if (this.info.ceil !== null) {
      const ct = flat(wad, this.info.ceil);
      this.scene.add(mesh(THREE, fl.ceil, ct
        ? material(THREE, {map: texture(THREE, ct, 128, 128, pal)})
        : material(THREE, {color: 0x1b1d24})));
    } else {
      this.scene.background = new THREE.Color(0x20242c);
    }

    // Doors: a leaf one storey tall that slides into the jamb, with ordinary
    // wall above it. A full-height leaf looks wrong in a tall level and is not
    // what ROTT draws -- see ../ROTT's addDoor, which this follows.
    this.doors = [];
    const H = this.storeys * TILE;
    const aboveLump = doorFace(wad, 'ABOVEW3');
    const aboveMat = aboveLump
      ? material(THREE, {map: texture(THREE, aboveLump, 64, 64, pal)})
      : material(THREE, {color: 0x555a66});
    for (const d of doors(p0, p1, p2)) {
      const tex = doorFace(wad, d.face);
      const mat = tex ? material(THREE, {map: texture(THREE, tex, 64, 64, pal)})
                      : material(THREE, {color: 0x6b6f7a});
      const cx = d.x * TILE + TILE / 2, cz = d.y * TILE + TILE / 2;

      // The leaf, built about the origin so it can slide by moving the mesh.
      const g = {pos: [], uv: []};
      quad(g, d.vertical ? [[0, 0, -32], [0, 0, 32], [0, TILE, 32], [0, TILE, -32]]
                         : [[-32, 0, 0], [32, 0, 0], [32, TILE, 0], [-32, TILE, 0]],
           UVBOX);
      const m = mesh(THREE, g, mat);
      m.position.set(cx, 0, cz);
      this.scene.add(m);

      // Everything above it fills the tile front to back, so looking up inside
      // a doorway does not show daylight through the wall, and gets a soffit.
      const y0 = TILE - 0.5, rest = H - y0;
      if (rest > 0) {
        const uvv = [[0, 0], [1, 0], [1, rest / 64], [0, rest / 64]];
        const a = {pos: [], uv: []};
        for (const s of [-32, 32])
          quad(a, d.vertical ? [[s, y0, -32], [s, y0, 32], [s, H, 32], [s, H, -32]]
                             : [[-32, y0, s], [32, y0, s], [32, H, s], [-32, H, s]],
               uvv);
        quad(a, [[-32, y0, -32], [32, y0, -32], [32, y0, 32], [-32, y0, 32]], UVBOX);
        const am = mesh(THREE, a, aboveMat);
        am.position.set(cx, 0, cz);
        this.scene.add(am);
      }

      this.doors.push({...d, m, cx, cz, open: 0, target: 0, hold: 0,
                       ti: d.y * DIM + d.x});
    }

    // Masked walls: railings, windows, archways. One batch per lump, and the
    // art's own holes are its shape -- alphaTest rather than a cut mesh.
    // ponytail: no end caps, so a railing seen from directly above is a line.
    // Add them when looking down on one looks wrong.
    const byLump = new Map();
    for (const w of maskWalls(wad, p0, this.storeys)) {
      if (!byLump.has(w.lump)) byLump.set(w.lump, {pos: [], uv: []});
      const g = byLump.get(w.lump);
      const cx = w.x * TILE + 32, cz = w.y * TILE + 32;
      const y0 = w.storey * TILE, y1 = y0 + TILE;
      const [n, s, ww, e] = w.faces;
      if (n) quad(g, [[cx - 32, y0, cz - 32], [cx + 32, y0, cz - 32],
                      [cx + 32, y1, cz - 32], [cx - 32, y1, cz - 32]], UVBOX);
      if (s) quad(g, [[cx + 32, y0, cz + 32], [cx - 32, y0, cz + 32],
                      [cx - 32, y1, cz + 32], [cx + 32, y1, cz + 32]], UVBOX);
      if (ww) quad(g, [[cx - 32, y0, cz + 32], [cx - 32, y0, cz - 32],
                       [cx - 32, y1, cz - 32], [cx - 32, y1, cz + 32]], UVBOX);
      if (e) quad(g, [[cx + 32, y0, cz - 32], [cx + 32, y0, cz + 32],
                      [cx + 32, y1, cz + 32], [cx + 32, y1, cz - 32]], UVBOX);
      if (w.blocking) this.solid[w.y * DIM + w.x] = 1;
    }
    for (const [lump, geo] of byLump) {
      if (!geo.pos.length) continue;
      const p = patchIndexed(wad, lump);
      const mat = p
        ? material(THREE, {map: texture(THREE, p.idx, p.w, p.h, pal, false, p.mask),
                           transparent: true, alphaTest: 0.1})
        : material(THREE, {color: 0x6b6f7a});
      this.scene.add(mesh(THREE, geo, mat));
    }

    // Static platforms: one flat, double-sided panel per piece -- like a door
    // leaf, the art is the only side of it anybody was ever meant to see.
    // Each panel runs the width of its tile along platformAxis, through the
    // tile's centre line.
    const platByLump = new Map();
    for (const w of platformWalls(p0, p1, p2, this.storeys)) {
      const lump = platformLumpName(wad, w.off);
      if (!lump) continue;
      if (!platByLump.has(lump)) platByLump.set(lump, {pos: [], uv: []});
      const g = platByLump.get(lump);
      const cx = w.x * TILE + TILE / 2, cz = w.y * TILE + TILE / 2;
      const y0 = w.storey * TILE, y1 = y0 + TILE;
      const pts = w.axis === 'x'
        ? [[cx - TILE / 2, y0, cz], [cx + TILE / 2, y0, cz],
           [cx + TILE / 2, y1, cz], [cx - TILE / 2, y1, cz]]
        : [[cx, y0, cz - TILE / 2], [cx, y0, cz + TILE / 2],
           [cx, y1, cz + TILE / 2], [cx, y1, cz - TILE / 2]];
      quad(g, pts, w.flip ? UVBOX_FLIP : UVBOX);
    }
    for (const [lump, geo] of platByLump) {
      if (!geo.pos.length) continue;
      const p = patchIndexed(wad, lump);
      const mat = p
        ? material(THREE, {map: texture(THREE, p.idx, p.w, p.h, pal, false, p.mask),
                           transparent: true, alphaTest: 0.1})
        : material(THREE, {color: 0x6b6f7a});
      this.scene.add(mesh(THREE, geo, mat));
    }

    // Static props: every decoration and pickup SetupStatics() places, drawn
    // as a camera-facing billboard the way ROTT itself draws every actor
    // (see level.js's props/spriteScale). One mesh each -- a billboard turns
    // to face the player every frame (see step), which a shared batched mesh
    // spanning many tiles cannot do.
    this.billboards = [];
    for (const pr of props(p0, p1)) {
      const lump = propLumpName(wad, pr.stat);
      const q = lump ? patchIndexed(wad, lump) : null;
      if (!q) continue;                 // a few names carry no art in shareware
      const {ow, oh, oy} = spriteScale(q);
      const g = {pos: [], uv: []};
      quad(g, [[-ow / 2, -oh / 2, 0], [ow / 2, -oh / 2, 0],
               [ow / 2, oh / 2, 0], [-ow / 2, oh / 2, 0]], UVBOX);
      const mat = material(THREE, {map: texture(THREE, q.idx, q.w, q.h, pal, false, q.mask),
                                   transparent: true, alphaTest: 0.1});
      const m = mesh(THREE, g, mat);
      m.position.set(pr.x * TILE + TILE / 2, oy + oh / 2, pr.y * TILE + TILE / 2);
      this.scene.add(m);
      this.billboards.push(m);
      if (pr.blocking) this.solid[pr.y * DIM + pr.x] = 1;
    }

    const s = spawnOf(p1);
    this.camera.position.set(s.x, EYE, s.z);
    this.yaw = s.deg * Math.PI / 180;
    this.pitch = 0;
    this.keys = {};
    this.vx = this.vz = 0;
    this.resize(canvas);
  }

  resize(canvas) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // A door is solid until it is most of the way open.
  doorAt(tx, tz) {
    for (const d of this.doors) if (d.x === tx && d.y === tz) return d;
    return null;
  }

  // Doors open on use, stand open for OPENTICS, then close when the way is
  // clear -- ROTT never shuts one on anybody.
  stepDoors(dt) {
    const p = this.camera.position;
    for (const d of this.doors) {
      if (d.open === d.target) {
        if (d.open === 1 && (d.hold += dt) >= OPENTICS &&
            !(Math.abs(p.x - d.cx) < 48 && Math.abs(p.z - d.cz) < 48)) d.target = 0;
        continue;
      }
      d.open = Math.max(0, Math.min(1, d.open + Math.sign(d.target - d.open) * dt * DOOR_SPEED));
      d.hold = 0;
      const slide = d.open * TILE;
      if (d.vertical) d.m.position.z = d.cz + slide;
      else d.m.position.x = d.cx + slide;
    }
  }

  // E on the nearest door within reach.
  use() {
    const p = this.camera.position;
    let best = null, bd = 96 * 96;
    for (const d of this.doors) {
      const q = (p.x - d.cx) ** 2 + (p.z - d.cz) ** 2;
      if (q < bd) { bd = q; best = d; }
    }
    if (!best) return null;
    if (best.lock) return `locked: ${best.lock} key`;
    best.target = best.target ? 0 : 1;
    best.hold = 0;
    return null;
  }

  // The four corners of the player's box, as the exporter tests them.
  blocked(x, z) {
    for (const dx of [-RADIUS, RADIUS]) {
      for (const dz of [-RADIUS, RADIUS]) {
        const tx = (x + dx) >> 6, tz = (z + dz) >> 6;
        if (tx < 0 || tz < 0 || tx >= DIM || tz >= DIM) return true;
        if (this.solid[tz * DIM + tx]) return true;
        const d = this.doorAt(tx, tz);
        if (d && d.open < 0.75) return true;
      }
    }
    return false;
  }

  step(dt) {
    const k = this.keys;
    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    // Taradino's own speeds: 282 walking, 615 running, approached at
    // ln(8/7) a tic (see ../ROTT for where those come from).
    const top = (k.ShiftLeft || k.ShiftRight) ? 615 : 282;
    const rate = Math.log(8 / 7) * 35;
    const wishX = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s;
    const wishZ = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
    const l = Math.hypot(wishX, wishZ) || 1;
    const push = top * 7 / 8 * 1.3;
    if (f || s) {
      this.vx += ((wishX / l) * push - this.vx) * Math.min(1, rate * dt);
      this.vz += ((wishZ / l) * push - this.vz) * Math.min(1, rate * dt);
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > top) { this.vx *= top / sp; this.vz *= top / sp; }
    } else {
      this.vx -= this.vx * Math.min(1, rate * dt);
      this.vz -= this.vz * Math.min(1, rate * dt);
    }
    const p = this.camera.position;
    const nx = p.x + this.vx * dt, nz = p.z + this.vz * dt;
    if (!this.blocked(nx, p.z)) p.x = nx; else this.vx = 0;
    if (!this.blocked(p.x, nz)) p.z = nz; else this.vz = 0;
    this.stepDoors(dt);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // ROTT turns every actor to face the player about the vertical axis
    // only, never tilting to follow pitch -- so a billboard read edge-on
    // from above still reads as flat art, not as a foreshortened sliver.
    for (const b of this.billboards) b.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.camera);
  }

  where() {
    const p = this.camera.position;
    return `${p.x >> 6},${p.z >> 6}`;
  }
}
