// Drawing a level, and walking around it.
//
// The art is 8-bit: every texture is palette indices, turned to RGBA here
// once. Walls are batched by tile so the whole level is a handful of draw
// calls.

import {DIM, TILE, walls, planesMesh, wallLump, flat, solidMap, storeysOf,
        levelInfo, spawnOf} from './level.js';

const RADIUS = 22;          // the player's half-width, as the exporter has it
const EYE = 39;             // z + playerheight in ROTT's own terms

// Column-major palette indices -> an RGBA texture. ROTT stores its art in
// columns; the canvas wants rows.
function texture(THREE, bytes, w, h, pal, colMajor = true) {
  const rgba = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = colMajor ? x * h + y : y * w + x;
      const p = bytes[i] * 3, o = (y * w + x) * 4;
      rgba[o] = pal[p]; rgba[o + 1] = pal[p + 1]; rgba[o + 2] = pal[p + 2]; rgba[o + 3] = 255;
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

function mesh(THREE, geo, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(geo.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uv, 2));
  return new THREE.Mesh(g, mat);
}

export class Level {
  constructor(THREE, canvas, wad, planes) {
    this.THREE = THREE;
    const [p0, p1] = planes;
    this.p0 = p0;
    this.storeys = storeysOf(p1);
    this.solid = solidMap(p0);
    this.info = levelInfo(p0);
    const pal = wad.pal;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 1, 9000);
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true});
    this.renderer.setPixelRatio(devicePixelRatio);

    for (const [tile, geo] of walls(p0, this.storeys)) {
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

  // The four corners of the player's box, as the exporter tests them.
  blocked(x, z) {
    for (const dx of [-RADIUS, RADIUS]) {
      for (const dz of [-RADIUS, RADIUS]) {
        const tx = (x + dx) >> 6, tz = (z + dz) >> 6;
        if (tx < 0 || tz < 0 || tx >= DIM || tz >= DIM) return true;
        if (this.solid[tz * DIM + tx]) return true;
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
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.renderer.render(this.scene, this.camera);
  }

  where() {
    const p = this.camera.position;
    return `${p.x >> 6},${p.z >> 6}`;
  }
}
