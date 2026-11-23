// A dog you can walk among four other characters and three props. Every
// sprite comes from a sheet that Zpup's render_sprites wrote: one PNG and its
// frame list, with a row per direction and, for the characters, a column per
// pose.

const W = 640;
const H = 400;
const SPEED = 110;

/**
 * How each sheet is shown. `height` is the height of a cell in canvas units;
 * `foot` is where the object touches the ground, as a share of the cell's
 * height; `front` is the direction, counted as the sheet counts them, in
 * which it faces the viewer; `shadow` is the half width of the shadow drawn
 * under it, for the ones whose scene has none.
 */
const LOOK = {
  dog: { height: 96, foot: 0.75, front: 0 },
  person: { height: 124, foot: 0.9, front: 0, shadow: 15 },
  robot: { height: 112, foot: 0.93, front: 0, shadow: 17 },
  cat: { height: 92, foot: 0.78, front: 6 },
  bird: { height: 84, foot: 0.56, front: 6, shadow: 13 },
  crate: { height: 96, foot: 0.75, front: 0, shadow: 26 },
  plant: { height: 96, foot: 0.79, front: 0, shadow: 18 },
  lamp: { height: 96, foot: 0.9, front: 0, shadow: 13 },
};
const CHARACTERS = ['dog', 'person', 'robot', 'cat', 'bird'];
const names = Object.keys(LOOK);

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
  return { name, image, frames, ...LOOK[name] };
}

const sheets = Object.fromEntries(
  (await Promise.all(names.map(loadSheet))).map((s) => [s.name, s]),
);

/**
 * The row of a sheet that faces the way something moves on screen. The
 * directions go round counterclockwise on screen: from facing the viewer,
 * which is down, to the right, to up.
 */
function facing(sheet, dx, dy) {
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const steps = -Math.round((degrees - 90) / 45);
  return (((steps + sheet.front) % 8) + 8) % 8;
}

const props = [
  { sheet: sheets.crate, x: 170, y: 190, row: 1, pose: 0, radius: 20 },
  { sheet: sheets.plant, x: 450, y: 140, row: 0, pose: 0, radius: 12 },
  { sheet: sheets.lamp, x: 530, y: 300, row: 0, pose: 0, radius: 7 },
];

const dog = { sheet: sheets.dog, x: 320, y: 330, row: 0, pose: 0, walked: 0 };

/** Walks round a fixed loop, forever. */
const person = {
  sheet: sheets.person,
  x: 70,
  y: 372,
  row: 0,
  pose: 0,
  walked: 0,
  route: [
    [590, 372],
    [590, 122],
    [70, 122],
    [70, 372],
  ],
  next: 0,
};

/** Walks up and down a line, and stands a while at each end. */
const robot = {
  sheet: sheets.robot,
  x: 300,
  y: 120,
  row: 0,
  pose: 0,
  walked: 0,
  ends: [
    [300, 290],
    [300, 120],
  ],
  next: 0,
  wait: 0,
};

/**
 * Sits, and now and then jumps to its next spot: crouch, in the air, land,
 * stand, sit. The poses are the columns of its sheet, in that order.
 */
const CAT = { stand: 0, sit: 1, crouch: 2, air: 3, land: 4 };
const cat = {
  sheet: sheets.cat,
  x: 215,
  y: 250,
  row: 6,
  pose: CAT.sit,
  spots: [
    [215, 250],
    [395, 215],
    [470, 345],
    [120, 320],
  ],
  spot: 0,
  from: [215, 250],
  state: 'sit',
  time: 0,
};

/** Flies in a circle above everything, flapping. */
const bird = { sheet: sheets.bird, x: 0, y: 0, row: 0, pose: 0, angle: 0, flapped: 0, lift: 96 };

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

/** Whether a point on the canvas is on the picture of something standing at its place. */
function onPicture(item, x, y) {
  const { height, foot } = item.sheet;
  const top = item.y - height * foot;
  return Math.abs(x - item.x) < height * 0.28 && y > top + height * 0.15 && y < item.y + 8;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  const box = canvas.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * W;
  const y = ((e.clientY - box.top) / box.height) * H;
  // A click on the cat makes it jump, one on a prop turns it; anywhere else
  // sends the dog there.
  if (onPicture(cat, x, y)) {
    if (cat.state === 'sit') jump();
    return;
  }
  const hit = props.find((p) => onPicture(p, x, y));
  if (hit) hit.row = (hit.row + 1) % hit.sheet.frames.length;
  else target = { x, y };
});

/** Moves something toward a point at a speed. Returns whether it has arrived. */
function walkTo(item, [tx, ty], speed, dt) {
  const dx = tx - item.x;
  const dy = ty - item.y;
  const length = Math.hypot(dx, dy);
  if (length < speed * dt) {
    item.x = tx;
    item.y = ty;
    return true;
  }
  item.row = facing(item.sheet, dx, dy);
  item.x += (dx / length) * speed * dt;
  item.y += (dy / length) * speed * dt;
  return false;
}

/** The pose of a walk after `walked` seconds, at `rate` poses a second. */
function stride(item, rate) {
  return Math.floor(item.walked * rate) % item.sheet.frames[0].length;
}

function stepDog(dt) {
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
  if (length === 0) {
    // Standing still is the first pose.
    dog.walked = 0;
    dog.pose = 0;
    return;
  }
  dog.walked += dt;
  dog.pose = stride(dog, 9);
  dog.row = facing(dog.sheet, dx, dy);
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

function stepPerson(dt) {
  person.walked += dt;
  person.pose = stride(person, 8);
  if (walkTo(person, person.route[person.next], 46, dt)) {
    person.next = (person.next + 1) % person.route.length;
  }
}

function stepRobot(dt) {
  if (robot.wait > 0) {
    robot.wait -= dt;
    robot.pose = 0;
    robot.walked = 0;
    return;
  }
  robot.walked += dt;
  robot.pose = stride(robot, 5);
  if (walkTo(robot, robot.ends[robot.next], 30, dt)) {
    robot.next = (robot.next + 1) % robot.ends.length;
    robot.wait = 1.6;
  }
}

function jump() {
  cat.from = [cat.x, cat.y];
  cat.spot = (cat.spot + 1) % cat.spots.length;
  const [tx, ty] = cat.spots[cat.spot];
  cat.row = facing(cat.sheet, tx - cat.x, ty - cat.y);
  cat.state = 'crouch';
  cat.time = 0;
}

/** How long the cat stays in each state, in seconds, and what comes next. */
const CAT_STEPS = {
  sit: [5, 'crouch'],
  crouch: [0.4, 'air'],
  air: [0.55, 'land'],
  land: [0.22, 'stand'],
  stand: [0.7, 'sit'],
};

function stepCat(dt) {
  cat.time += dt;
  const [length, next] = CAT_STEPS[cat.state];
  // It also jumps away when the dog comes close.
  const near = Math.hypot(dog.x - cat.x, dog.y - cat.y) < 46;
  if (cat.state === 'sit' && (cat.time >= length || near)) {
    jump();
  } else if (cat.time >= length) {
    cat.state = next;
    cat.time = 0;
  }
  if (cat.state === 'air') {
    const t = Math.min(1, cat.time / CAT_STEPS.air[0]);
    const [tx, ty] = cat.spots[cat.spot];
    cat.x = cat.from[0] + (tx - cat.from[0]) * t;
    cat.y = cat.from[1] + (ty - cat.from[1]) * t;
  }
  cat.pose = CAT[cat.state];
}

function stepBird(dt) {
  bird.angle += dt * 0.42;
  bird.flapped += dt;
  bird.x = W / 2 + Math.cos(bird.angle) * 235;
  bird.y = H / 2 + 30 + Math.sin(bird.angle) * 120;
  // It faces along the circle: the way it moves.
  bird.row = facing(bird.sheet, -Math.sin(bird.angle) * 235, Math.cos(bird.angle) * 120);
  bird.pose = Math.floor(bird.flapped * 9) % bird.sheet.frames[0].length;
}

function shadow(x, y, half) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.beginPath();
  ctx.ellipse(x, y, half, half / 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function paint(item, lift = 0) {
  const { image, frames, height, foot } = item.sheet;
  const f = frames[item.row][item.pose];
  const width = (height * f.w) / f.h;
  ctx.drawImage(
    image,
    f.x,
    f.y,
    f.w,
    f.h,
    item.x - width / 2,
    item.y - height * foot - lift,
    width,
    height,
  );
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (target) shadow(target.x, target.y, 6);
  // Painted from the back of the ground to the front, by where each stands.
  for (const item of [...props, dog, person, robot, cat].sort((a, b) => a.y - b.y)) {
    if (item.sheet.shadow) shadow(item.x, item.y, item.sheet.shadow);
    paint(item);
  }
  // The bird is above all of them, and its shadow is on the ground under it.
  shadow(bird.x, bird.y, bird.sheet.shadow);
  paint(bird, bird.lift);
}

let last = performance.now();
function tick(now) {
  // The first frame can carry a time from before the sheets finished loading.
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  stepDog(dt);
  stepPerson(dt);
  stepRobot(dt);
  stepCat(dt);
  stepBird(dt);
  draw();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The sheets themselves, under the stage.
const list = document.getElementById('sheets');
for (const name of [...CHARACTERS, 'crate', 'plant', 'lamp']) {
  const posed = CHARACTERS.includes(name);
  const count = sheets[name].frames[0].length;
  const figure = document.createElement('figure');
  figure.className = posed ? 'sheet posed' : 'sheet';
  const image = document.createElement('img');
  image.src = `${name}.png`;
  image.alt = posed
    ? `The ${name} from eight directions, one in each row, in ${count} poses`
    : `The ${name} from eight directions`;
  image.loading = 'lazy';
  const caption = document.createElement('figcaption');
  const poses = posed ? ` and the <a href="${name}.poses.json">${count} poses</a>` : '';
  caption.innerHTML = `<code>${name}.png</code>, its <a href="${name}.json">frame list</a> and the <a href="${name}.scene.json">scene</a>${poses} it was drawn from.`;
  figure.append(image, caption);
  list.append(figure);
}
