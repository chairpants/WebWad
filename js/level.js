// What a level's tiles mean, and the geometry that follows from them.
//
// Ported from ../ROTT (rott.py's predicates, level_info, level_height and the
// wall-lump lookup). The comments that say *why* a range is what it is live
// there, beside the citation; what is here is the rule itself.

export const DIM = 128, TILE = 64;

// 106, 224-233 and 242-244 are walls that ROTT sends to SetupAnimatedWall,
// and 107 is AREATILE -- floor, not wall.
const STATIC_WALL = new Set([106, 224, 225, 226, 227, 228, 229, 230, 231, 232,
                             233, 242, 243, 244]);

// 33-35 are doors ROTT gives door textures 15-17, so they are excluded from
// the wall range below.
export const isDoor = (v) => (v >= 33 && v <= 35) || (v >= 90 && v <= 104);
export const isWall = (v) => STATIC_WALL.has(v) || (v >= 1 && v <= 89 && !isDoor(v));
export const isMask = (v) => (v >= 157 && v <= 160) || (v >= 162 && v <= 179);
export const isArea = (v) => v >= 108 && v <= 154;
export const blocks = (v) => isWall(v) || isDoor(v);

// Storeys, from the height icon at plane-1 tile (0,0).
export function storeysOf(p1) {
  const v = p1[0];
  if (v >= 90 && v <= 97) return v - 89;
  if (v >= 450 && v <= 457) return v - 441;
  return 1;
}

// (floor flat, ceiling flat, sky) from the metadata in row 0. A sky level has
// no ceiling.
export function levelInfo(p0) {
  const t = p0[1];
  if (t >= 234) return {floor: p0[0] - 179, ceil: null, sky: t - 233};
  return {floor: p0[0] - 179, ceil: t - 197, sky: 0};
}

// Where the player starts, and which way they face. Plane-1 19-22 are the
// four start icons.
const FACING = {19: 180, 20: 90, 21: 0, 22: 270};
export function spawnOf(p1) {
  for (let i = 0; i < p1.length; i++) {
    const deg = FACING[p1[i]];
    if (deg !== undefined)
      return {x: (i % DIM) * TILE + TILE / 2, z: ((i / DIM) | 0) * TILE + TILE / 2, deg};
  }
  return {x: DIM * TILE / 2, z: DIM * TILE / 2, deg: 0};
}

// The wall texture for a plane-0 tile: ROTT's own lookup, most tiles landing
// in the WALL section at shifting offsets, 47-48 in EXIT and 72-79 the
// elevator walls. Animated tiles are drawn from their static texture here.
const ANIM_STATIC = {106: 74, 224: 74, 225: 74, 226: 74, 227: 74, 228: 74,
                     229: 74, 230: 74, 231: 74, 232: 74, 233: 74,
                     242: 74, 243: 74, 244: 74};
export function wallLump(wad, tile) {
  const ws = wad.idx.get('WALLSTRT'), es = wad.idx.get('EXITSTRT'),
        ev = wad.idx.get('ELEVSTRT');
  if (ws === undefined) return null;
  let i;
  if (tile >= 1 && tile <= 32) i = ws + tile;
  else if (tile >= 36 && tile <= 45) i = ws + tile - 3;
  else if (tile === 46) i = ws + 74;
  else if (tile >= 47 && tile <= 48) i = es + tile - 46;
  else if (tile >= 49 && tile <= 71) i = ws + tile - 8;
  else if (tile >= 72 && tile <= 79) i = ev + tile - 71;
  else if (tile >= 80 && tile <= 89) i = ws + tile - 16;
  else if (tile in ANIM_STATIC) i = ws + ANIM_STATIC[tile];
  else return null;
  const b = wad.lumpAt(i);
  return b && b.length === 4096 ? b : null;
}

// Floor and ceiling are one flat each for the whole level: FLRCL<n>, eight
// bytes of header then 128x128.
export function flat(wad, num) {
  const d = wad.byName('FLRCL' + num);
  return (d && d.length >= 16392) ? d.subarray(8, 8 + 16384) : null;
}

// One byte per tile: anything that is not walkable floor blocks, the void
// outside the level included.
export function solidMap(p0) {
  const out = new Uint8Array(p0.length);
  for (let i = 0; i < p0.length; i++) {
    const v = p0[i];
    out[i] = (isArea(v) || isDoor(v) || isMask(v)) ? 0 : 1;
  }
  return out;
}

// Wall faces, as one batch per texture. A face is only built where the tile
// next to it is something you can see from -- ROTT draws walls the same way,
// and it keeps the mesh to what is actually visible.
export function walls(p0, storeys) {
  const H = storeys * TILE;
  const at = (x, y) => (x < 0 || y < 0 || x >= DIM || y >= DIM) ? 0 : p0[y * DIM + x];
  const seen = (x, y) => { const v = at(x, y); return !(isWall(v) || v === 0); };
  const byTile = new Map();
  const face = (tile, quad) => {
    if (!byTile.has(tile)) byTile.set(tile, {pos: [], uv: []});
    const g = byTile.get(tile);
    const [a, b, c, d] = quad;
    for (const [p, u] of [[a, [0, 0]], [b, [1, 0]], [c, [1, 1]],
                          [a, [0, 0]], [c, [1, 1]], [d, [0, 1]]]) {
      g.pos.push(p[0], p[1], p[2]);
      g.uv.push(u[0], u[1] * storeys);
    }
  };
  for (let y = 0; y < DIM; y++) {
    for (let x = 0; x < DIM; x++) {
      const v = at(x, y);
      if (!isWall(v)) continue;
      const X = x * TILE, Z = y * TILE, E = X + TILE, S = Z + TILE;
      if (seen(x, y - 1)) face(v, [[X, 0, Z], [E, 0, Z], [E, H, Z], [X, H, Z]]);
      if (seen(x, y + 1)) face(v, [[E, 0, S], [X, 0, S], [X, H, S], [E, H, S]]);
      if (seen(x - 1, y)) face(v, [[X, 0, S], [X, 0, Z], [X, H, Z], [X, H, S]]);
      if (seen(x + 1, y)) face(v, [[E, 0, Z], [E, 0, S], [E, H, S], [E, H, Z]]);
    }
  }
  return byTile;
}

// The floor and ceiling, as one quad each over the whole map, with the flat
// repeated a tile at a time.
export function planesMesh(storeys) {
  const N = DIM * TILE, H = storeys * TILE;
  const quad = (y, flip) => {
    const c = [[0, y, 0], [N, y, 0], [N, y, N], [0, y, N]];
    const o = flip ? [c[0], c[3], c[2], c[0], c[2], c[1]] : [c[0], c[1], c[2], c[0], c[2], c[3]];
    const uv = flip ? [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]]
                    : [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    const pos = [];
    for (const p of o) pos.push(p[0], p[1], p[2]);
    const uvs = [];
    for (const t of uv) uvs.push(t[0] * DIM, t[1] * DIM);
    return {pos, uv: uvs};
  };
  return {floor: quad(0, false), ceil: quad(H, true)};
}


// ---- doors ---------------------------------------------------------------
// Ported from ../ROTT's rott_doors.py, which is SpawnDoor and SetupDoors read
// closely: which lump a door's face uses, and which way round it hangs.

const DOOR_FACE = {0: 'RAMDOOR1', 1: 'DOOR2', 2: 'TRIDOOR1', 3: 'TRIDOOR1',
                   8: 'RAMDOOR1', 9: 'DOOR2', 10: 'SDOOR4', 11: 'SDOOR4',
                   12: 'EDOOR', 13: 'TRIDOOR1', 14: 'SDOOR4'};
const KEY_NAMES = ['gold', 'silver', 'iron', 'oscuro'];

// rt_door.c's own IsWall/IsDoor, both wider than the drawing ones.
const wallC = (v) => (v >= 1 && v <= 89) || (v >= 106 && v <= 107) ||
                     (v >= 224 && v <= 233) || (v >= 242 && v <= 244);
const doorC = (v) => (v >= 33 && v <= 35) || (v >= 90 && v <= 104) ||
                     (v >= 154 && v <= 156);

// SpawnDoor's orientation test, on (north, south, west, east).
function doorVertical(n, s, w, e) {
  const score = (v) => doorC(v) ? 2 : (wallC(v) ? 1 : 0);
  const up = score(n), dn = score(s), lt = score(w), rt = score(e);
  if (up === 1 && dn === 1) return true;
  if (lt === 1 && rt === 1) return false;
  if (up > 0 && dn > 0) return true;
  if (lt > 0 && rt > 0) return false;
  if (up > 0 || dn > 0) return true;
  return false;
}

// Every door in the level: where it is, which way it hangs, what it shows,
// and whether a key holds it shut.
export function doors(p0, p1, p2) {
  const at = (x, y) => (x < 0 || y < 0 || x >= DIM || y >= DIM) ? 0 : p0[y * DIM + x];
  const out = [];
  for (let y = 0; y < DIM; y++) {
    for (let x = 0; x < DIM; x++) {
      const v = at(x, y);
      if (v < 90 || v > 104) continue;
      const face = DOOR_FACE[v - 90];
      if (!face) continue;                  // 94..97: ROTT rejects these
      const icon = p1[y * DIM + x];
      const keyed = icon >= 29 && icon <= 32;
      out.push({
        x, y, face,
        side: keyed ? 'LOCK' + (icon - 28) : 'SIDE8',
        vertical: doorVertical(at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)),
        lock: keyed ? KEY_NAMES[icon - 29] : (p2[y * DIM + x] ? 'locked' : null),
      });
    }
  }
  return out;
}

// A door's face lump, raw 64x64 like a wall.
export function doorFace(wad, name) {
  const b = wad.byName(name);
  return b && b.length === 4096 ? b : null;
}

// ---- masked walls --------------------------------------------------------
// Railings, windows, archways: a tile that is not a wall but is not empty
// either. Ported from ../ROTT's rott_doors.mask_lumps, which is rt_door.c's
// SpawnMaskedWall read as a table. Drawn as a stack of one-storey pieces, and
// unlike the exporter's version without the end caps -- see render.js.

const MULTI_BOTTOM = ['MULTI1', 'MULTI2', 'MULTI3'];
const MULTI_MID = ['ABOVEM5A', 'ABOVEM5B', 'ABOVEM5C'];
// tile -> [bottom base, already-broken, blocking, bottom passable]
const NORMAL = {162: ['MASKED1', 0, 1, 0], 163: ['MASKED1', 1, 1, 0],
                164: ['MASKED2', 0, 1, 0], 165: ['MASKED2', 1, 1, 0],
                166: ['MASKED3', 0, 1, 0], 167: ['MASKED3', 1, 1, 0],
                168: ['MASKED4', 0, 1, 0], 169: ['MASKED4', 1, 0, 1]};

// SpawnMaskedWall computes these off the HMSKSTRT marker by position, not by
// name -- the shareware WAD even misspells one of them.
function himask(wad, n) {
  const i = wad.idx.get('HMSKSTRT');
  return i === undefined ? null : wad.nameAt(i + 1 + n);
}

export function maskLumps(wad, tile) {
  const M = (bottom, middle, above, blocking) =>
    ({bottom, middle, above, blocking: !!blocking});
  if (tile === 157 || tile === 175)
    return M(himask(wad, 0), himask(wad, 1), himask(wad, tile === 175 ? 3 : 2), 1);
  if (tile >= 158 && tile <= 160)
    return M(MULTI_BOTTOM[tile - 158], MULTI_MID[tile - 158], 'ABOVEM5', 1);
  if (tile >= 176 && tile <= 178)
    return M(MULTI_BOTTOM[tile - 176] + 'A', MULTI_MID[tile - 176], 'ABOVEM5', 0);
  if (tile in NORMAL) {
    let [base, broken, blocking] = NORMAL[tile];
    // MASKED1 and MASKED3 are not in the shareware WAD though thirty tiles
    // use them; rt_door.c already substitutes the 4-series for the other
    // pieces, so the bottom gets the same treatment or the wall is an
    // invisible block. See ../ROTT for the whole argument.
    if (!wad.idx.has(base)) base = 'MASKED2';
    return M(base + (broken ? 'A' : ''), 'ABOVEM4A', 'ABOVEM4', blocking);
  }
  if (tile === 172) return M('EXITARCH', 'ABOVEM4A', 'ABOVEM4', 0);
  if (tile === 173) return M('EXITARCA', 'ABOVEM4A', 'ABOVEM4', 0);
  if (tile === 174) return M('ENTRARCH', 'ABOVEM4A', 'ABOVEM4', 1);
  if (tile === 179) return M('RAILING', null, null, 0);
  if (tile === 170) return M('DOGMASK', 'ABOVEM4A', 'ABOVEM4', 0);
  if (tile === 171) return M('PEEPMASK', 'ABOVEM4A', 'ABOVEM4', 1);
  return null;               // 161: ROTT's own unused "pillar" case
}

// Every masked wall in the level, as a list of one-storey pieces. A piece
// wears its art on each side facing open space -- a side shut against a wall,
// or against another tile of the same value, is art nobody can see and art
// that would z-fight with its neighbour's.
export function maskWalls(wad, p0, storeys) {
  const at = (x, y) => (x < 0 || y < 0 || x >= DIM || y >= DIM) ? 0 : p0[y * DIM + x];
  const out = [];
  for (let y = 0; y < DIM; y++) {
    for (let x = 0; x < DIM; x++) {
      const v = at(x, y);
      if (!isMask(v)) continue;
      const r = maskLumps(wad, v);
      if (!r) continue;
      const shut = (nx, ny) => { const n = at(nx, ny); return isWall(n) || n === v; };
      const faces = [!shut(x, y - 1), !shut(x, y + 1), !shut(x - 1, y), !shut(x + 1, y)];
      const pieces = [];
      if (r.bottom) pieces.push([r.bottom, 0]);
      if (r.middle) for (let s = 1; s < storeys - 1; s++) pieces.push([r.middle, s]);
      if (r.above && storeys >= 2) pieces.push([r.above, storeys - 1]);
      for (const [lump, storey] of pieces)
        out.push({x, y, lump, storey, faces, blocking: r.blocking});
    }
  }
  return out;
}
