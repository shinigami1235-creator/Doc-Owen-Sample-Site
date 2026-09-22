/* Dr. Owen Aguilar-Joven
   The lotus mark, extruded into real geometry and flown down the page.
   Falls back to the flat CSS mark if WebGL is missing. */

import * as THREE from './three.module.min.js';
import { SVGLoader } from './SVGLoader.js';

const canvas = document.getElementById('lotus3d');
const cssFlyer = document.getElementById('flyer');
const anchor = document.getElementById('anchor');
const anchor2 = document.getElementById('anchor2');   // the slot above the closing heading
if (!canvas || !anchor) throw new Error('no mount');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) throw new Error('reduced motion');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  throw new Error('no webgl');           // the CSS mark stays visible
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 13);

/* ---- light: cool key from upper left, warm rose fill, rim behind ---- */
scene.add(new THREE.HemisphereLight(0xeaf1f8, 0x6d7683, 0.95));
const key = new THREE.DirectionalLight(0xfffaf6, 2.9);
key.position.set(-4.5, 6, 8);
scene.add(key);
const fill = new THREE.DirectionalLight(0xf3e2e4, 0.55);   // barely warm, no violet cast
fill.position.set(6, -2.5, 4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xc9dcf0, 1.15);
rim.position.set(1.5, 2.5, -6);
scene.add(rim);

/* ---- colours, matching the flat mark ---- */
const INK = 0x14335e, RED = 0xd22b3f, BLUSH = 0xe3919b;
const PICK = { '#14335e': INK, '#d22b3f': RED, '#e3919b': BLUSH };

const mat = hex => new THREE.MeshPhysicalMaterial({
  color: hex,
  roughness: hex === BLUSH ? 0.5 : 0.38,
  metalness: 0.0,
  clearcoat: 0.55,
  clearcoatRoughness: 0.3,
  side: THREE.DoubleSide
});

const flower = new THREE.Group();
const pivot = new THREE.Group();     // carries position + travel
pivot.add(flower);
scene.add(pivot);

const petals = [];
let ready = false;

new SVGLoader().load('assets/lotus-plain.svg', data => {
  const group = new THREE.Group();

  data.paths.forEach(path => {
    const css = '#' + path.color.getHexString();
    const colour = PICK[css] !== undefined ? PICK[css] : INK;
    const material = mat(colour);
    const depth = colour === BLUSH ? 12 : colour === RED ? 20 : 26;

    SVGLoader.createShapes(path).forEach(shape => {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: 5,
        bevelSize: 4,
        bevelSegments: 3,
        curveSegments: 12
      });
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.userData.colour = colour;
      group.add(mesh);
    });
  });

  /* SVG space is y-down and huge: flip, centre, normalise to ~4 units tall */
  group.scale.y *= -1;
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3(); box.getSize(size);
  const mid = new THREE.Vector3(); box.getCenter(mid);
  const k = 1.62 / Math.max(size.x, size.y);

  group.children.forEach(m => {
    m.geometry.translate(-mid.x, -mid.y * -1, -mid.z);   // y was flipped on the group
  });
  group.scale.multiplyScalar(k);
  group.scale.y = -Math.abs(group.scale.y);

  /* each mesh becomes its own petal so it can open */
  const base = new THREE.Vector3(0, -2.0, 0);
  group.children.slice().forEach(m => {
    const holder = new THREE.Group();
    group.remove(m);
    holder.add(m);
    flower.add(holder);

    const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
    const side = c.x < -0.25 ? -1 : c.x > 0.25 ? 1 : 0;
    petals.push({
      holder,
      side,
      rest: holder.rotation.clone(),
      open: side === 0 ? 0 : side * -0.85,     // closed tilt
      lift: side === 0 ? 1.15 : 0.55,
      d: petals.length
    });
  });
  flower.scale.copy(group.scale);

  /* centre the assembled flower on its pivot, and record the resting width so
     the on-screen size can be pinned to the anchor slot at any viewport */
  flower.position.set(0, 0, 0);
  flower.updateMatrixWorld(true);
  const fb = new THREE.Box3().setFromObject(flower);
  const fc = fb.getCenter(new THREE.Vector3());
  BASE_W = fb.getSize(new THREE.Vector3()).x || 1;
  flower.position.set(-fc.x, -fc.y, -fc.z);

  petals.sort((a, b) => a.d - b.d);
  fitScale();
  ready = true;
  document.body.classList.add('has3d');
  if (cssFlyer) cssFlyer.style.display = 'none';
}, undefined, () => { /* keep the CSS mark */ });

/* ---- where the flower flies ---- */
let WP = [], t0 = performance.now(), bloomStart = 0;
let BASE_W = 1, FIT = 1;

/* the flower reads as the mark in its slot, whatever the screen */
function fitScale() {
  const r = anchor.getBoundingClientRect();
  const h = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
  const worldPerPx = (h * camera.aspect) / innerWidth;
  FIT = (r.width * 0.94 * worldPerPx) / BASE_W;
}

function waypoints() {
  const narrow = innerWidth < 900;
  /* x,y in world units at z=0; the camera sees roughly 8 x 4.5 at this fov */
  const ax = ndcToWorld(anchorNDC());
  const end = endTarget();
  const bx = end, bs = end.s;
  /* narrow screens have no side margin, so the mark drops to a watermark the
     moment it leaves its slot, and comes back only over the closing panel */
  return narrow ? [
    { p: 0,   x: ax.x, y: ax.y, s: 1,    rx: 0,    ry: 0,    o: .16 },
    { p: .05, x: 1.15, y: 1.5,  s: .92,  rx: 0.024,  ry: 0.12,  o: .17 },
    { p: .24, x: 1.30, y: 0.9,  s: .86,  rx: 0.04,  ry: 0.22,  o: .15 },
    { p: .42, x: -1.32,y: -1.5, s: .78,  rx: -0.04, ry: -0.24, o: .13 },
    { p: .60, x: 1.32, y: -1.2, s: .82,  rx: 0.032,  ry: 0.2,  o: .14 },
    { p: .80, x: -1.28,y: 1.5,  s: .88,  rx: -0.036, ry: -0.2, o: .15 },
    { p: .93, x: -0.6, y: 1.9,  s: 1.10, rx: -0.016, ry: -0.08, o: .40 },
    { p: 1,   x: bx.x, y: bx.y, s: bs,   rx: 0,    ry: 0,    o: 1 }
  ] : [
    { p: 0,   x: ax.x, y: ax.y, s: 1,    rx: 0,    ry: 0,    o: .34 },
    { p: .06, x: 4.2,  y: 2.0,  s: 1.15, rx: 0.032,  ry: 0.16,  o: .34 },
    { p: .15, x: 4.9,  y: 1.7,  s: 1.30, rx: 0.048,  ry: 0.248,  o: .32 },
    { p: .32, x: -5.1, y: -1.5, s: 1.12, rx: -0.052, ry: -0.264, o: .27 },
    { p: .50, x: 5.2,  y: -1.9, s: 1.05, rx: 0.044,  ry: 0.232,  o: .25 },
    { p: .68, x: -5.2, y: 1.8,  s: 1.18, rx: -0.048, ry: -0.24, o: .28 },
    { p: .85, x: 4.8,  y: 0.6,  s: 1.34, rx: 0.04,  ry: 0.216,  o: .33 },
    { p: 1,   x: bx.x, y: bx.y, s: bs,   rx: 0,    ry: 0,    o: 1 }
  ];
}
/* where the mark comes to rest over the closing panel, in world units */
function endTarget() {
  if (!anchor2) return { x: 0, y: 1.35, s: 1.3 };
  const r = anchor2.getBoundingClientRect();
  const endTop = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const yAtEnd = Math.max(r.top + scrollY - endTop + r.height / 2, 84 + r.height / 2);
  const w = ndcToWorld({ x: (r.left + r.width / 2) / innerWidth * 2 - 1,
                         y: -(yAtEnd / innerHeight * 2 - 1) });
  w.s = r.width / Math.max(1, anchor.getBoundingClientRect().width);
  return w;
}
function anchorNDC(el) {
  const r = (el || anchor).getBoundingClientRect();
  const x = (r.left + r.width / 2) / innerWidth * 2 - 1;
  const y = -((r.top + r.height / 2) / innerHeight * 2 - 1);
  return { x, y };
}
function ndcToWorld(n) {
  const h = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z;
  return { x: n.x * (h * camera.aspect) / 2, y: n.y * h / 2 };
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  WP = waypoints();
  fitScale();
}
resize();
addEventListener('resize', resize);

/* pointer parallax */
let px = 0, py = 0, cpx = 0, cpy = 0;
if (matchMedia('(hover:hover) and (pointer:fine)').matches)
  addEventListener('pointermove', e => {
    px = (e.clientX / innerWidth - .5) * 2;
    py = (e.clientY / innerHeight - .5) * 2;
  }, { passive: true });

const cur = { x: 0, y: 0, s: 1, rx: 0, ry: 0, o: 1 };
let first = true;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function frame(now) {
  requestAnimationFrame(frame);
  if (!ready) return;
  const t = (now - t0) / 1000;
  if (!bloomStart) bloomStart = t;

  /* bloom: each petal unfolds, staggered */
  const el = t - bloomStart;
  petals.forEach((pt, i) => {
    const d = Math.min(1, Math.max(0, (el - i * 0.055) / 1.3));
    const e = 1 - Math.pow(1 - d, 3);
    pt.holder.rotation.z = lerp(pt.open, 0, e);
    pt.holder.scale.setScalar(lerp(0.34, 1, e));
    pt.holder.position.y = lerp(-pt.lift, 0, e);
  });

  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const p = Math.min(1, Math.max(0, scrollY / max));
  if (p > .75) {
    const e2 = endTarget(), last = WP[WP.length - 1];
    last.x = e2.x; last.y = e2.y; last.s = e2.s;
  }
  let a = WP[0], z = WP[WP.length - 1];
  for (let i = 0; i < WP.length - 1; i++)
    if (p >= WP[i].p && p <= WP[i + 1].p) { a = WP[i]; z = WP[i + 1]; break; }
  const k = smooth(z.p === a.p ? 0 : (p - a.p) / (z.p - a.p));

  const ease = first ? 1 : .085;
  cur.x = lerp(cur.x, lerp(a.x, z.x, k), ease);
  cur.y = lerp(cur.y, lerp(a.y, z.y, k), ease);
  cur.s = lerp(cur.s, lerp(a.s, z.s, k), ease);
  cur.rx = lerp(cur.rx, lerp(a.rx, z.rx, k), ease);
  cur.ry = lerp(cur.ry, lerp(a.ry, z.ry, k), ease);
  /* opacity follows the scroll with no lag, so the mark is already faint by the
     time the hero copy slides under it; it is solid only while it sits in its slot */
  const inSlot = 1 - smooth(Math.min(1, scrollY / 170));
  const home = 1 - Math.min(1, Math.hypot(cur.x - WP[0].x, cur.y - WP[0].y) / 1.1);
  cur.o = lerp(lerp(a.o, z.o, k), 1, inSlot * home);
  cpx = lerp(cpx, px, .05); cpy = lerp(cpy, py, .05);
  first = false;

  pivot.position.set(cur.x + Math.sin(t * .31) * .10, cur.y + Math.sin(t * .47) * .13, 0);
  pivot.scale.setScalar(cur.s * FIT);
  /* upright: only gentle tilt, never a tumble */
  flower.rotation.x = cur.rx - cpy * .09 + Math.sin(t * .39) * .03;
  flower.rotation.y = cur.ry + cpx * .14 + Math.sin(t * .29) * .05;
  flower.rotation.z = Math.sin(t * .34) * .05;

  canvas.style.opacity = cur.o.toFixed(3);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
