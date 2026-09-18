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
// outside the level included. `platset` (tile index -> true) is a static
// platform's footprint -- ROTT's solid_map treats every platform tile as
// walkable regardless of plane-0, never mind that plane-0 21 sitting under
// it would otherwise read as an ordinary wall. See `platforms` below.
export function solidMap(p0, platset = null) {
  const out = new Uint8Array(p0.length);
  for (let i = 0; i < p0.length; i++) {
    const v = p0[i];
    out[i] = ((platset && platset.has(i)) || isArea(v) || isDoor(v) || isMask(v)) ? 0 : 1;
  }
  return out;
}

// Wall faces, as one batch per texture. A face is only built where the tile
// next to it is something you can see from -- ROTT draws walls the same way,
// and it keeps the mesh to what is actually visible. `platset`: see solidMap.
export function walls(p0, storeys, platset = null) {
  const H = storeys * TILE;
  const at = (x, y) => (x < 0 || y < 0 || x >= DIM || y >= DIM) ? 0 : p0[y * DIM + x];
  const isPlat = (x, y) => !!(platset && platset.has(y * DIM + x));
  const seen = (x, y) => { if (isPlat(x, y)) return true; const v = at(x, y); return !(isWall(v) || v === 0); };
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
      if (isPlat(x, y) || !isWall(v)) continue;
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

// Static platforms use the same HMSKSTRT-relative table; exported so
// render.js can turn a platformWalls() piece's offset into a lump name.
export function platformLumpName(wad, off) {
  return off === null || off === undefined ? null : himask(wad, off);
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

// ---- static platforms -----------------------------------------------------
// Raised discs and pedestals plane 2 places over open floor. Ported from
// ../ROTT's rott_plane2.decode (its platform branch) and rott.py's
// platform_axis/PLATFORM_PIECES. A platform tile is a masked wall in
// everything but where it is spawned from: plane-0 21 sits under every one of
// them, which reads as an ordinary wall to isWall/solidMap and would seal off
// whatever the platform was there to reach -- see solidMap and walls above,
// which both take a platset to see past that.

// tile -> ROTT's own platform1..platform7 naming.
const PLATFORM_NAMES = {1: 'platform7', 4: 'platform1', 5: 'platform2',
                        6: 'platform3', 7: 'platform4', 8: 'platform5',
                        9: 'platform6'};

// [bottom, middle, above, flip] offsets from HMSKSTRT; null where ROTT's own
// spawn table leaves that piece out. `flip` names which of bottom/above is
// drawn vertically flipped -- middle pieces never are.
const PLATFORM_PIECES = {
  platform1: [null, null, 10, ''], platform2: [8, null, null, 'bottom'],
  platform3: [8, null, 10, 'bottom'], platform4: [12, 7, 7, ''],
  platform5: [12, 7, 5, 'top'], platform6: [4, 7, 5, 'top'],
  platform7: [4, 7, 5, ''],
};

// Doors, push/move walls and the level clock all read plane 2 for their own
// ends and are checked first in rott_plane2.decode, before its platform
// branch -- ported here only as membership tests, since WebWad does not spawn
// any of those yet, to keep a tile that happens to carry one of them from
// being misread as a platform.
const P2_DOOR = (v) => (v >= 33 && v <= 35) || (v >= 90 && v <= 93) ||
                       (v >= 98 && v <= 104) || (v >= 154 && v <= 156);
const P2_RESERVED = (v) => (v >= 72 && v <= 80) || (v >= 256 && v <= 259) ||
                           v === 300 || v === 318 || v === 336 || v === 354 ||
                           v === 121;

// Every static platform tile: plane 2 holds 1 or 4-9 wherever ROTT's own
// IsPlatform() is true. Row 0's first four tiles are level metadata (RTL
// header spot ROTT itself never reads as a tile), never a platform whatever
// plane 2 says there.
export function platforms(p0, p1, p2) {
  const out = [];
  for (let i = 0; i < p0.length; i++) {
    const x = i % DIM, y = (i / DIM) | 0;
    if (y === 0 && x < 4) continue;
    if (P2_DOOR(p0[i]) || P2_RESERVED(p1[i])) continue;
    const kind = PLATFORM_NAMES[p2[i]];
    if (kind) out.push({x, y, kind});
  }
  return out;
}

// A platform hugs the face of a neighbouring wall rather than filling a gap
// in a wall line, so it runs ALONG that wall -- the opposite convention to a
// door or masked wall, which plug a hole and continue its run.
function platformAxis(at, x, y) {
  if (isWall(at(x, y - 1)) || isWall(at(x, y + 1))) return 'x';
  if (isWall(at(x - 1, y)) || isWall(at(x + 1, y))) return 'z';
  return 'x';
}

// Every static platform's pieces: same stacking as a masked wall (bottom at
// storey 0, middle repeating between, above capping the top), with the axis
// they hang along instead of which sides face open space.
export function platformWalls(p0, p1, p2, storeys) {
  const at = (x, y) => (x < 0 || y < 0 || x >= DIM || y >= DIM) ? 0 : p0[y * DIM + x];
  const out = [];
  for (const {x, y, kind} of platforms(p0, p1, p2)) {
    const spec = PLATFORM_PIECES[kind];
    if (!spec) continue;
    const [bot, mid, abv, flip] = spec;
    const axis = platformAxis(at, x, y);
    if (bot !== null) out.push({x, y, axis, off: bot, storey: 0, flip: flip === 'bottom'});
    if (mid !== null) for (let s = 1; s < storeys - 1; s++) out.push({x, y, axis, off: mid, storey: s, flip: false});
    if (abv !== null && storeys >= 2) out.push({x, y, axis, off: abv, storey: storeys - 1, flip: flip === 'top'});
  }
  return out;
}

// ---- static props ----------------------------------------------------------
// Every decoration, pickup and piece of scenery ROTT's SetupStatics() places
// from plane 1 -- torches, columns, weapons lying on the floor, key
// pedestals, touchplates, all of it. Ported from ../ROTT's rott_gfx.py
// (STATIC_TILE_STAT, STAT_SPR_INDEX, actor_lump) and rott_props.py's PROPS
// (block only -- hp/shoot/debris/heat are combat, which this viewer has none
// of). Drawn as a camera-facing billboard the way ROTT itself draws every
// actor, never as a flat decal on the floor.

// plane-1 tile -> ROTT's own stat_xxx naming (rt_stat.c's `stats[]` row).
// HUNTBGIN.WAD is the shareware IWAD, and rt_stat.c's SpawnStatic() already
// substitutes several types for it (extra light colours to stat_blight, the
// lamp to stat_altbrazier2) -- baked in here rather than re-derived.
const STATIC_TILE_STAT = {
  23: 'stat_blight', 24: 'stat_blight', 25: 'stat_blight', 26: 'stat_blight',
  27: 'stat_blight', 28: 'stat_altbrazier2',
  29: 'stat_pedgoldkey', 30: 'stat_pedsilverkey', 31: 'stat_pedironkey',
  32: 'stat_pedcrystalkey',
  33: 'stat_gibs1', 34: 'stat_gibs2', 35: 'stat_gibs3',
  36: 'stat_monkmeal', 37: 'stat_priestporridge',
  38: 'stat_monkcrystal1', 39: 'stat_monkcrystal2',
  40: 'stat_oneup', 41: 'stat_threeup',
  42: 'stat_altbrazier1', 43: 'stat_altbrazier2',
  44: 'stat_healingbasin', 45: 'stat_emptybasin',
  46: 'stat_bat', 47: 'stat_knifestatue',
  48: 'stat_twopistol', 49: 'stat_mp40', 50: 'stat_bazooka',
  51: 'stat_firebomb', 52: 'stat_heatseeker', 53: 'stat_drunkmissile',
  54: 'stat_firewall', 55: 'stat_splitmissile', 56: 'stat_kes',
  57: 'stat_lifeitem1', 58: 'stat_lifeitem2', 59: 'stat_lifeitem3',
  60: 'stat_lifeitem4',
  61: 'stat_tntcrate', 62: 'stat_bonusbarrel',
  63: 'stat_torch', 64: 'stat_floorfire',
  65: 'stat_dipball1', 66: 'stat_dipball2', 67: 'stat_dipball3',
  68: 'stat_touch1', 69: 'stat_touch2', 70: 'stat_touch3', 71: 'stat_touch4',
  98: 'stat_dariantouch',
  210: 'stat_scotthead',
  228: 'stat_metalshards', 229: 'stat_metalshards', 230: 'stat_metalshards',
  231: 'stat_metalshards', 232: 'stat_grate', 233: 'stat_metalshards',
  246: 'stat_emptypedestal', 247: 'stat_emptytable', 248: 'stat_stool',
  249: 'stat_bcolumn', 250: 'stat_gcolumn', 251: 'stat_icolumn',
  252: 'stat_godmode', 253: 'stat_dogmode', 254: 'stat_fleetfeet',
  255: 'stat_random',
  260: 'stat_elastic', 261: 'stat_mushroom', 262: 'stat_tomlarva',
  263: 'stat_collector',
  264: 'stat_tree', 265: 'stat_plant', 266: 'stat_urn',
  267: 'stat_emptystatue',
  268: 'stat_haystack', 269: 'stat_ironbarrel',
  270: 'stat_bulletproof', 271: 'stat_asbesto', 272: 'stat_gasmask',
  282: 'stat_heatgrate', 283: 'stat_standardpole', 284: 'stat_pit',
  // 461 (stat_disk) left out on purpose: it is FL_BLOCK but a moving
  // elevator platform ROTT rides, not a static decoration -- see
  // ../ROTT's rott_props.py. Drawing it here as a motionless billboard
  // would misrepresent a mechanic this viewer does not model at all yet.
};

// stat_xxx -> index of its sprite in sprites.h's shape enum; a lump's WAD
// index is SHAPSTRT's own index plus this.
const STAT_SPR_INDEX = {
  stat_ylight: 1015, stat_rlight: 1016, stat_glight: 1017,
  stat_blight: 1018, stat_chandelier: 1019, stat_lamp: 1020,
  stat_pedgoldkey: 973, stat_pedsilverkey: 973, stat_pedironkey: 973,
  stat_pedcrystalkey: 973,
  stat_gibs1: 989, stat_gibs2: 990, stat_gibs3: 991,
  stat_monkmeal: 1022, stat_priestporridge: 1040,
  stat_monkcrystal1: 1046, stat_monkcrystal2: 1052,
  stat_oneup: 895, stat_threeup: 2404,
  stat_altbrazier1: 1059, stat_altbrazier2: 1024,
  stat_healingbasin: 1036, stat_emptybasin: 1039,
  stat_bat: 2380, stat_knifestatue: 2364,
  stat_twopistol: 1081, stat_mp40: 1082, stat_bazooka: 1083,
  stat_firebomb: 1084, stat_heatseeker: 1085, stat_drunkmissile: 1086,
  stat_firewall: 1087, stat_splitmissile: 1089, stat_kes: 1088,
  stat_lifeitem1: 903, stat_lifeitem2: 911, stat_lifeitem3: 934,
  stat_lifeitem4: 919,
  stat_tntcrate: 1025, stat_bonusbarrel: 992,
  stat_torch: 1059, stat_floorfire: 1074,
  stat_dipball1: 2350, stat_dipball2: 2351, stat_dipball3: 2352,
  stat_touch1: 993, stat_touch2: 994, stat_touch3: 995, stat_touch4: 996,
  stat_dariantouch: 970, stat_scotthead: 2357,
  stat_grate: 1028, stat_metalshards: 1029,
  stat_emptypedestal: 1030, stat_emptytable: 1031, stat_stool: 1032,
  stat_bcolumn: 759, stat_gcolumn: 759, stat_icolumn: 759,
  stat_tree: 1033, stat_plant: 1034, stat_urn: 999,
  stat_haystack: 1000, stat_ironbarrel: 1035,
  stat_heatgrate: 1011, stat_standardpole: 1003, stat_pit: 1093,
  stat_godmode: 855, stat_dogmode: 2396, stat_fleetfeet: 879,
  stat_elastic: 863, stat_mushroom: 887, stat_gasmask: 1090,
  stat_bulletproof: 1091, stat_asbesto: 1092, stat_random: 871,
  stat_emptystatue: 2372, stat_tomlarva: 2353, stat_collector: 680,
};

// rott_props.PROPS, trimmed to the one field this viewer can act on: whether
// the prop is FL_BLOCK (solid -- you walk up to it, not through it). The
// hitpoint/shootable/debris/heat columns are all combat, which nothing here
// has a use for yet.
const PROP_BLOCKS = new Set([
  'stat_altbrazier1', 'stat_altbrazier2', 'stat_bcolumn', 'stat_bonusbarrel',
  'stat_dariantouch', 'stat_emptybasin', 'stat_emptypedestal',
  'stat_emptystatue', 'stat_emptytable', 'stat_floorfire', 'stat_gcolumn',
  'stat_haystack', 'stat_healingbasin', 'stat_icolumn', 'stat_ironbarrel',
  'stat_knifestatue', 'stat_lamp', 'stat_pedcrystalkey', 'stat_pedgoldkey',
  'stat_pedironkey', 'stat_pedsilverkey', 'stat_plant', 'stat_standardpole',
  'stat_stool', 'stat_tntcrate', 'stat_tomlarva', 'stat_torch', 'stat_tree',
  'stat_urn',
]);

// 29-32 are the four key pedestals, but only where they stand on the floor --
// over a door tile the same value is that door's lock (see doors() above),
// and SetupStatics() skips it: `case 29..32: if (IsDoor(i,j) == 0)`.
const DOOR_LOCK_TILES = new Set([29, 30, 31, 32]);

// (0,0)/(1,0) are level metadata (height/horizon icons), and 19-22 are the
// four player-start facings -- neither is ever a static.
const PROP_SKIP_TILE = new Set([19, 20, 21, 22]);

// Every static prop in the level: where it is and which sprite draws it.
export function props(p0, p1) {
  const out = [];
  for (let i = 0; i < p1.length; i++) {
    if (i === 0 || i === 1 || p1[i] === 0 || PROP_SKIP_TILE.has(p1[i])) continue;
    const v = p1[i];
    if (DOOR_LOCK_TILES.has(v) && isDoor(p0[i])) continue;
    const stat = STATIC_TILE_STAT[v];
    if (!stat) continue;
    out.push({x: i % DIM, y: (i / DIM) | 0, stat, blocking: PROP_BLOCKS.has(stat)});
  }
  return out;
}

// Lump name for a stat_xxx's sprite, or null if this WAD does not carry it
// (the shareware build is missing several -- see ../ROTT's _selftest_props).
export function propLumpName(wad, stat) {
  const idx = STAT_SPR_INDEX[stat];
  const strt = wad.idx.get('SHAPSTRT'), stop = wad.idx.get('SHAPSTOP');
  if (idx === undefined || strt === undefined || stop === undefined) return null;
  const i = strt + idx;
  if (!(i > strt && i < stop)) return null;
  const l = wad.lumps[i];
  return l && l.sz ? l.name : null;
}

// ../ROTT's add_sprite: topoffset anchors the art vertically, so its bottom
// sits at (orig + top - h) tile-scaled; a billboard's own centre then sits
// half its height above that. `q` is a patchIndexed() result.
export function spriteScale(q) {
  const k = TILE / q.orig;
  return {ow: q.w * k, oh: q.h * k, oy: (q.orig + q.top - q.h) * k};
}
