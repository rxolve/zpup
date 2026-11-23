// A dog you can walk around three props. Every sprite comes from a sheet
// that Zpup's render_sprites wrote: one PNG and its frame list. The dog's
// sheet has a row per direction and a column per pose of its walk.

const W = 480;
const H = 320;
/** Sprites are drawn at this size, in canvas units; the sheets have twice as many pixels. */
const SIZE = 96;
/** Where an object touches the ground, as a share of the cell's height. */
const FOOT = { dog: 0.75, crate: 0.75, plant: 0.79, lamp: 0.9 };
const SPEED = 110;
/** Poses of the walk shown per second. */
const STEPS = 9;

const canvas = document.getElementById('stage');
canvas.width = W * 2;
canvas.height = H * 2;
const ctx = canvas.getContext('2d');
ctx.scale(2, 2);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/**
 * Reads a sheet as render_sprites writes it: for each direction, in the
 * order they turn, its poses in order. A sheet without poses has one each.
 */
async function loadSheet(name) {
  const [list, image] = await Promise.all([
    fetch(`${name}.json`).then((r) => r.json()),
    loadImage(`${name}.png`),
  ]);
  const byTurn = new Map();
  for (const f of Object.values(list.frames)) {
    if (!byTurn.has(f.turn)) byTurn.set(f.turn, []);
    byTurn.get(f.turn).push(f);
  }
  const frames = [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, poses]) => poses.sort((a, b) => (a.pose ?? 0) - (b.pose ?? 0)).map((f) => f.frame));
  return { name, image, frames };
}

const names = ['dog', 'crate', 'plant', 'lamp'];
const sheets = Object.fromEntries(
  (await Promise.all(names.map(loadSheet))).map((s) => [s.name, s]),
);

const dog = { sheet: sheets.dog, x: 240, y: 250, frame: 0, moving: false, walked: 0 };
const props = [
  { sheet: sheets.crate, x: 130, y: 150, frame: 1, radius: 20 },
  { sheet: sheets.plant, x: 330, y: 120, frame: 0, radius: 12 },
  { sheet: sheets.lamp, x: 390, y: 235, frame: 0, radius: 7 },
];

/**
 * The frame that faces the way the dog moves on screen. Frame 0 faces the
 * viewer, which is down; each next frame is turned 45 degrees further.
 */
function facing(dx, dy) {
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const steps = Math.round((degrees - 90) / 45) * TURN;
  return ((steps % 8) + 8) % 8;
}
/** Which way round the frames go on screen: set from the sheet. */
const TURN = -1;

const keys = new Set();
let target = null;
const MOVES = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};
addEventListener('keydown', (e) => {
  if (!(e.key in MOVES) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement !== canvas && e.key.startsWith('Arrow')) return;
  keys.add(e.key);
  target = null;
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('blur', () => keys.clear());

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  const box = canvas.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * W;
  const y = ((e.clientY - box.top) / box.height) * H;
  // A click on a prop turns it; anywhere else sends the dog there.
  const hit = props.find((p) => {
    const top = p.y - SIZE * FOOT[p.sheet.name];
    return Math.abs(x - p.x) < SIZE * 0.28 && y > top + SIZE * 0.15 && y < p.y + 8;
  });
  if (hit) hit.frame = (hit.frame + 1) % hit.sheet.frames.length;
  else target = { x, y };
});

function step(dt) {
  let dx = 0;
  let dy = 0;
  for (const key of keys) {
    dx += MOVES[key][0];
    dy += MOVES[key][1];
  }
  if (dx === 0 && dy === 0 && target) {
    dx = target.x - dog.x;
    dy = target.y - dog.y;
    if (Math.hypot(dx, dy) < 3) {
      target = null;
      dx = 0;
      dy = 0;
    }
  }
  const length = Math.hypot(dx, dy);
  dog.moving = length > 0;
  if (!dog.moving) {
    dog.walked = 0;
    return;
  }
  dog.walked += dt;
  dog.frame = facing(dx, dy);
  let x = dog.x + (dx / length) * SPEED * dt;
  let y = dog.y + (dy / length) * SPEED * dt;
  // The dog walks round the props: it is pushed out of a circle at each foot.
  let blocked = false;
  for (const p of props) {
    const away = Math.hypot(x - p.x, y - p.y);
    const least = p.radius + 12;
    if (away < least && away > 0) {
      x = p.x + ((x - p.x) / away) * least;
      y = p.y + ((y - p.y) / away) * least;
      blocked = true;
    }
  }
  dog.x = Math.min(W - 34, Math.max(34, x));
  dog.y = Math.min(H - 8, Math.max(40, y));
  // A click behind a prop cannot be reached; give up when hardly moving.
  if (target && blocked && Math.hypot(target.x - dog.x, target.y - dog.y) < 40) target = null;
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (target) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(target.x, target.y, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Painted from the back of the ground to the front, by where each stands.
  for (const item of [...props, dog].sort((a, b) => a.y - b.y)) {
    const { image, frames, name } = item.sheet;
    const poses = frames[item.frame];
    // Standing still is the first pose; walking plays them in turn.
    const pose = item === dog && dog.moving ? Math.floor(dog.walked * STEPS) % poses.length : 0;
    const f = poses[pose];
    // The dog's scene has its own shadow; the props get one here.
    if (item !== dog) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.beginPath();
      ctx.ellipse(item.x, item.y, item.radius + 6, (item.radius + 6) / 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.drawImage(
      image,
      f.x,
      f.y,
      f.w,
      f.h,
      item.x - SIZE / 2,
      item.y - SIZE * FOOT[name],
      SIZE,
      SIZE,
    );
  }
}

let last = performance.now();
function tick(now) {
  step(Math.min(0.05, (now - last) / 1000));
  last = now;
  draw();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The sheets themselves, under the stage.
const list = document.getElementById('sheets');
for (const name of names) {
  const figure = document.createElement('figure');
  figure.className = 'sheet';
  const image = document.createElement('img');
  image.src = `${name}.png`;
  image.alt =
    name === 'dog'
      ? 'The dog from eight directions, one in each row, in the four poses of its walk'
      : `The ${name} from eight directions`;
  image.loading = 'lazy';
  const caption = document.createElement('figcaption');
  const poses =
    name === 'dog' ? ' and the <a href="dog.poses.json">four poses</a> of its walk' : '';
  caption.innerHTML = `<code>${name}.png</code>, its <a href="${name}.json">frame list</a> and the <a href="${name}.scene.json">scene</a>${poses} it was drawn from.`;
  figure.append(image, caption);
  list.append(figure);
}
