// A small game of chopping trees and building a cabin. Every sprite comes
// from a sheet that Zpup's render_sprites wrote: one PNG and its frame list,
// with a row per direction and a column per pose. The rules, the paths and
// the timing are written by hand, here.

const W = 640;
const H = 440;
const SPEED = 118;
const LOADED_SPEED = 100;
/** How many logs the person carries at most, and how many the cabin takes. */
const LOAD = 5;
const NEED = 15;
/** The cabin shows its next stage when this many logs have arrived. */
const STAGES = [0, 3, 7, 11, 15];
const HITS = 3;
const LOGS_PER_TREE = 3;

/**
 * How each sheet is shown. `height` is the height of a cell in canvas units;
 * `foot` is where the object touches the ground, as a share of the cell's
 * height; `front` is the direction, counted as the sheet counts them, in
 * which it faces the viewer; `shadow` is the half width of the shadow drawn
 * under it, for the ones whose scene has none.
 */
const LOOK = {
  person: { height: 162, foot: 0.87, front: 0, shadow: 15 },
  tree: { height: 236, foot: 0.84, front: 0, shadow: 24 },
  log: { height: 30, foot: 0.72, front: 0 },
  house: { height: 206, foot: 0.77, front: 0 },
  dog: { height: 96, foot: 0.75, front: 0 },
  cat: { height: 92, foot: 0.78, front: 6 },
  bird: { height: 84, foot: 0.56, front: 6, shadow: 13 },
  plant: { height: 96, foot: 0.79, front: 0, shadow: 18 },
  lamp: { height: 96, foot: 0.9, front: 0, shadow: 13 },
};
/** The columns of the person's sheet. */
const POSE = {
  walk: [0, 1, 2, 3, 4, 5],
  stand: 6,
  raised: 7,
  swing: 8,
  struck: 9,
  carry: [10, 11, 12, 13, 14, 15],
};
/** The columns of the tree's sheet. */
const TREE = { up: 0, shakeA: 1, shakeB: 2, lean: 3, falling: 4, stump: 5 };
/** The columns of the log's sheet: on the ground with its shadow, and carried, without. */
const LOG = { lying: 0, carried: 1 };
const POSED = ['person', 'tree', 'house', 'log', 'dog', 'cat', 'bird'];
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
 * `middle` is where the scene's middle is across a cell, as a share of its
 * width: a sheet made with fit says so in its frame list.
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
  const middle = list.meta.origin ? list.meta.origin.x / frames[0][0].w : 0.5;
  return { name, image, frames, middle, ...LOOK[name] };
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
  const count = sheet.frames.length;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  const steps = -Math.round((degrees - 90) / (360 / count));
  return (((steps + sheet.front) % count) + count) % count;
}

const TREE_SPOTS = [
  [62, 185],
  [165, 168],
  [268, 190],
  [110, 300],
  [222, 305],
  [58, 415],
];
/** The building site: an oval on the ground, with the cabin's middle at its middle. */
const SITE = { x: 490, y: 270, rx: 80, ry: 42 };
const CAT = { stand: 0, sit: 1, crouch: 2, air: 3, land: 4 };

let trees;
let logs;
let flying;
let props;
let person;
let dog;
let cat;
let house;
let bird;
let game;
let target = null;

function reset() {
  trees = TREE_SPOTS.map(([x, y], i) => ({
    sheet: sheets.tree,
    x,
    y,
    row: (i % 2) * 2,
    pose: TREE.up,
    state: 'up',
    time: 0,
    hits: 0,
    radius: 9,
    scale: 1,
  }));
  logs = [];
  flying = [];
  props = [
    { sheet: sheets.plant, x: 350, y: 395, row: 0, pose: 0, radius: 12 },
    { sheet: sheets.lamp, x: 380, y: 225, row: 0, pose: 0, radius: 7 },
  ];
  person = {
    sheet: sheets.person,
    x: 330,
    y: 300,
    row: 0,
    pose: POSE.stand,
    walked: 0,
    chopped: 0,
    carrying: 0,
    gave: 0,
    fx: 0,
    fy: 1,
  };
  dog = { sheet: sheets.dog, x: 290, y: 330, row: 0, pose: 0, walked: 0 };
  cat = {
    sheet: sheets.cat,
    x: 430,
    y: 380,
    row: 6,
    pose: CAT.sit,
    spots: [
      [430, 380],
      [560, 390],
      [590, 200],
      [400, 190],
    ],
    spot: 0,
    from: [430, 380],
    state: 'sit',
    time: 0,
  };
  house = { sheet: sheets.house, x: SITE.x, y: SITE.y, row: 7, pose: 0, grew: 1 };
  bird = { sheet: sheets.bird, x: 0, y: 0, row: 0, pose: 0, angle: 0, flapped: 0, lift: 110 };
  game = { started: false, done: false, time: 0, delivered: 0, since: 0 };
  target = null;
}

const keys = new Set();
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
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (game.done && e.key === 'Enter' && game.since > 0.8) {
    reset();
    return;
  }
  if (!(e.key in MOVES)) return;
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
  return Math.abs(x - item.x) < height * 0.2 && y > top + height * 0.15 && y < item.y + 8;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (game.done) {
    if (game.since > 0.8) reset();
    return;
  }
  const box = canvas.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * W;
  const y = ((e.clientY - box.top) / box.height) * H;
  // A click on a tree sends the person to its foot, where the chopping
  // starts by itself; one on the cabin sends the person to its front.
  const tree = trees.find((t) => t.state === 'up' && onPicture(t, x, y));
  if (tree) {
    const side = person.x < tree.x ? -1 : 1;
    target = { x: tree.x + side * 24, y: tree.y + 6 };
  } else if (inSite(x, y, 0)) {
    target = { x: SITE.x - 40, y: SITE.y + SITE.ry + 16 };
  } else {
    target = { x, y };
  }
});

/** Whether a point on the ground is on the building site, grown by a margin. */
function inSite(x, y, margin) {
  const dx = (x - SITE.x) / (SITE.rx + margin);
  const dy = (y - SITE.y) / (SITE.ry + margin);
  return dx * dx + dy * dy < 1;
}

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

/** Which of `count` poses a walk shows after `walked` seconds, at `rate` poses a second. */
function stride(walked, rate, count) {
  return Math.floor(walked * rate) % count;
}

function face(dx, dy) {
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  person.fx = dx / length;
  person.fy = dy / length;
  person.row = facing(person.sheet, dx, dy);
}

/** One cut of the axe takes this long; the blade lands at STRIKE. */
const CHOP = 0.52;
const STRIKE = 0.34;

function stepPerson(dt) {
  let dx = 0;
  let dy = 0;
  for (const key of keys) {
    dx += MOVES[key][0];
    dy += MOVES[key][1];
  }
  if (dx === 0 && dy === 0 && target) {
    dx = target.x - person.x;
    dy = target.y - person.y;
    if (Math.hypot(dx, dy) < 3) {
      target = null;
      dx = 0;
      dy = 0;
    }
  }
  const length = Math.hypot(dx, dy);
  if (length > 0) {
    game.started = true;
    person.chopped = 0;
    person.walked += dt;
    const loaded = person.carrying > 0;
    const poses = loaded ? POSE.carry : POSE.walk;
    person.pose = poses[stride(person.walked, 9, poses.length)];
    face(dx, dy);
    const speed = loaded ? LOADED_SPEED : SPEED;
    let x = person.x + (dx / length) * speed * dt;
    let y = person.y + (dy / length) * speed * dt;
    // The person walks round the trees and props: a circle at each foot.
    let blocked = false;
    for (const o of [...props, ...trees]) {
      const away = Math.hypot(x - o.x, y - o.y);
      const least = o.radius + 11;
      if (away < least && away > 0) {
        x = o.x + ((x - o.x) / away) * least;
        y = o.y + ((y - o.y) / away) * least;
        blocked = true;
      }
    }
    // The site is an oval: the person is pushed out along the line from its middle.
    if (inSite(x, y, 10)) {
      const ux = (x - SITE.x) / (SITE.rx + 10);
      const uy = (y - SITE.y) / (SITE.ry + 10);
      const u = Math.hypot(ux, uy) || 1;
      x = SITE.x + (ux / u) * (SITE.rx + 10);
      y = SITE.y + (uy / u) * (SITE.ry + 10);
      blocked = true;
    }
    person.x = Math.min(W - 24, Math.max(24, x));
    person.y = Math.min(H - 8, Math.max(56, y));
    // A click behind something cannot be reached; give up when hardly moving.
    if (target && blocked && Math.hypot(target.x - person.x, target.y - person.y) < 44) {
      target = null;
    }
    return;
  }

  person.walked = 0;
  // Standing by a tree is chopping it.
  const tree = trees
    .filter((t) => t.state === 'up' || t.state === 'shake')
    .map((t) => ({ t, away: Math.hypot(t.x - person.x, t.y - person.y) }))
    .filter((n) => n.away < 40)
    .sort((a, b) => a.away - b.away)[0]?.t;
  if (!tree) {
    person.chopped = 0;
    person.pose = POSE.stand;
    return;
  }
  game.started = true;
  face(tree.x - person.x, tree.y - person.y);
  const before = person.chopped % CHOP;
  person.chopped += dt;
  const phase = person.chopped % CHOP;
  if (before < STRIKE && phase >= STRIKE) hit(tree);
  person.pose = phase < 0.2 ? POSE.raised : phase < STRIKE ? POSE.swing : POSE.struck;
}

function hit(tree) {
  tree.hits += 1;
  tree.time = 0;
  if (tree.hits < HITS) {
    tree.state = 'shake';
    return;
  }
  tree.state = 'fall';
  // It falls away from the person: the sheet's first row falls to the right.
  tree.row = person.x < tree.x ? 0 : 2;
}

function stepTrees(dt) {
  for (const tree of trees) {
    tree.time += dt;
    if (tree.state === 'shake') {
      tree.pose = tree.time < 0.07 ? TREE.shakeA : tree.time < 0.14 ? TREE.shakeB : TREE.up;
      if (tree.time >= 0.14) tree.state = 'up';
    } else if (tree.state === 'fall') {
      tree.pose = tree.time < 0.13 ? TREE.lean : TREE.falling;
      if (tree.time >= 0.3) {
        tree.state = 'stump';
        tree.pose = TREE.stump;
        tree.time = 0;
        drop(tree);
      }
    } else if (tree.state === 'stump' && tree.time >= 11) {
      tree.state = 'grow';
      tree.pose = TREE.up;
      tree.time = 0;
      tree.hits = 0;
    } else if (tree.state === 'grow') {
      tree.scale = Math.min(1, 0.25 + tree.time * 0.6);
      if (tree.scale === 1) tree.state = 'up';
    }
  }
}

/** The logs of a felled tree land on the side it fell to. */
function drop(tree) {
  const side = tree.row === 0 ? 1 : -1;
  for (let i = 0; i < LOGS_PER_TREE; i++) {
    const x = tree.x + side * (30 + i * 24) + (Math.random() - 0.5) * 10;
    const y = tree.y + (Math.random() - 0.5) * 34 + 4;
    logs.push({
      sheet: sheets.log,
      from: [tree.x + side * 20, tree.y],
      to: [Math.min(W - 20, Math.max(20, x)), Math.min(H - 8, Math.max(60, y))],
      x: tree.x,
      y: tree.y,
      // Lying askew: seen straight from the side a log is only a bar.
      row: 1 + 2 * Math.floor(Math.random() * 4),
      pose: LOG.lying,
      time: 0,
      lift: 0,
    });
  }
}

function stepLogs(dt) {
  for (const log of logs) {
    log.time += dt;
    const t = Math.min(1, log.time / 0.4);
    log.x = log.from[0] + (log.to[0] - log.from[0]) * t;
    log.y = log.from[1] + (log.to[1] - log.from[1]) * t;
    log.lift = Math.sin(t * Math.PI) * 26;
  }
  // The person picks up the logs that lie within reach, while there is room.
  logs = logs.filter((log) => {
    const lying = log.time >= 0.4;
    const near = Math.hypot(log.x - person.x, log.y - person.y) < 30;
    if (!lying || !near || person.carrying >= LOAD) return true;
    person.carrying += 1;
    return false;
  });

  // At the site the load goes into the cabin, a log at a time.
  person.gave += dt;
  const room = NEED - game.delivered - flying.length;
  if (person.carrying > 0 && room > 0 && inSite(person.x, person.y, 34) && person.gave > 0.13) {
    person.gave = 0;
    person.carrying -= 1;
    flying.push({
      sheet: sheets.log,
      from: [person.x, person.y, 66 + person.carrying * 9],
      to: [SITE.x, SITE.y, 30],
      x: person.x,
      y: person.y,
      row: person.row,
      pose: LOG.carried,
      time: 0,
      lift: 0,
    });
  }
  for (const log of flying) {
    log.time += dt;
    const t = Math.min(1, log.time / 0.32);
    log.x = log.from[0] + (log.to[0] - log.from[0]) * t;
    log.y = log.from[1] + (log.to[1] - log.from[1]) * t;
    log.lift = log.from[2] + (log.to[2] - log.from[2]) * t + Math.sin(t * Math.PI) * 30;
  }
  const arrived = flying.filter((log) => log.time >= 0.32).length;
  if (arrived > 0) {
    flying = flying.filter((log) => log.time < 0.32);
    game.delivered += arrived;
    const stage = STAGES.findLastIndex((n) => game.delivered >= n);
    if (stage !== house.pose) {
      house.pose = stage;
      house.grew = 0;
    }
    if (game.delivered >= NEED) {
      game.done = true;
      game.since = 0;
      target = null;
    }
  }
  house.grew = Math.min(1, house.grew + dt * 3.2);
}

/** The dog keeps a little behind the person, and stands when it is close. */
function stepDog(dt) {
  const tx = person.x - person.fx * 34;
  const ty = person.y - person.fy * 22 + 6;
  const away = Math.hypot(tx - dog.x, ty - dog.y);
  if (away < 16 || (dog.walked === 0 && away < 44)) {
    dog.walked = 0;
    dog.pose = 0;
    return;
  }
  dog.walked += dt;
  dog.pose = stride(dog.walked, 9, dog.sheet.frames[0].length);
  walkTo(dog, [tx, ty], away > 90 ? 150 : 112, dt);
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
  sit: [9, 'crouch'],
  crouch: [0.4, 'air'],
  air: [0.55, 'land'],
  land: [0.22, 'stand'],
  stand: [0.7, 'sit'],
};

/** Sits, and jumps to its next spot now and then, or when the dog comes close. */
function stepCat(dt) {
  cat.time += dt;
  const [length, next] = CAT_STEPS[cat.state];
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
  bird.x = W / 2 + Math.cos(bird.angle) * 250;
  bird.y = H / 2 + 40 + Math.sin(bird.angle) * 130;
  // It faces along the circle: the way it moves.
  bird.row = facing(bird.sheet, -Math.sin(bird.angle) * 250, Math.cos(bird.angle) * 130);
  bird.pose = Math.floor(bird.flapped * 9) % bird.sheet.frames[0].length;
}

function shadow(x, y, half) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.beginPath();
  ctx.ellipse(x, y, half, half / 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws a cell of a sheet with its foot at the item's place, `lift` above the ground. */
function paint(item, lift = 0, scale = 1) {
  const { image, frames, height, foot, middle } = item.sheet;
  const f = frames[item.row][item.pose];
  const h = height * scale;
  const w = (h * f.w) / f.h;
  ctx.drawImage(image, f.x, f.y, f.w, f.h, item.x - w * middle, item.y - h * foot - lift, w, h);
}

/** The logs on the person's back: one sheet, turned the way the person is turned. */
function paintLoad() {
  for (let i = 0; i < person.carrying; i++) {
    paint(
      {
        sheet: sheets.log,
        x: person.x - person.fx * 19,
        y: person.y - person.fy * 9,
        row: person.row,
        pose: LOG.carried,
      },
      66 + i * 9,
    );
  }
}

function paintPerson() {
  shadow(person.x, person.y, person.sheet.shadow);
  // Facing the viewer, the back and its load are behind the body.
  const behind = person.fy > 0.3;
  if (behind) paintLoad();
  paint(person);
  if (!behind) paintLoad();
}

function paintHouse() {
  // A new stage arrives with a small bounce.
  paint(house, 0, 1 + Math.sin(house.grew * Math.PI) * 0.05);
}

function clock(seconds) {
  const whole = Math.floor(seconds);
  const tenth = Math.floor((seconds - whole) * 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenth}`;
}

function paintWords() {
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#2b2723';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Logs ${game.delivered} / ${NEED}`, 14, 12);
  ctx.textAlign = 'right';
  ctx.fillText(clock(game.time), W - 14, 12);

  ctx.textAlign = 'center';
  if (!game.started) {
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillText('Stand by a tree to chop it. Carry the logs to the site.', W / 2, 36);
  }
  if (game.done) {
    ctx.fillStyle = 'rgba(251, 248, 243, 0.9)';
    ctx.fillRect(W / 2 - 150, 22, 300, 62);
    ctx.fillStyle = '#2b2723';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(`Built in ${clock(game.time)}`, W / 2, 32);
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText('Click, or press Enter, to build it again.', W / 2, 58);
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (target) shadow(target.x, target.y, 6);
  // Painted from the back of the ground to the front, by where each stands.
  const items = [
    ...props.map((p) => ({ y: p.y, paint: () => paint(p), shadow: p })),
    ...trees.map((t) => ({ y: t.y, paint: () => paint(t, 0, t.scale), shadow: t })),
    ...logs.map((l) => ({ y: l.y, paint: () => paint(l, l.lift) })),
    // The cabin stands on the middle of its site.
    { y: dog.y, paint: () => paint(dog) },
    { y: cat.y, paint: () => paint(cat) },
    { y: person.y, paint: paintPerson },
    { y: house.y, paint: paintHouse },
  ];
  for (const item of items.sort((a, b) => a.y - b.y)) {
    const s = item.shadow;
    if (s?.sheet.shadow && s.pose !== TREE.stump) shadow(s.x, s.y, s.sheet.shadow * (s.scale ?? 1));
    item.paint();
  }
  for (const log of flying) paint(log, log.lift);
  // The bird is above all of them, and its shadow is on the ground under it.
  shadow(bird.x, bird.y, bird.sheet.shadow);
  paint(bird, bird.lift);
  paintWords();
}

reset();
let last = performance.now();
function tick(now) {
  // The first frame can carry a time from before the sheets finished loading.
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (game.done) {
    game.since += dt;
    person.pose = POSE.stand;
  } else {
    if (game.started) game.time += dt;
    stepPerson(dt);
  }
  stepTrees(dt);
  stepLogs(dt);
  stepDog(dt);
  stepCat(dt);
  stepBird(dt);
  draw();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The sheets themselves, under the stage.
const list = document.getElementById('sheets');
for (const name of ['person', 'tree', 'house', 'log', 'dog', 'cat', 'bird', 'plant', 'lamp']) {
  const posed = POSED.includes(name);
  const rows = sheets[name].frames.length;
  const count = sheets[name].frames[0].length;
  const figure = document.createElement('figure');
  figure.className = posed ? 'sheet posed' : 'sheet';
  const image = document.createElement('img');
  image.src = `${name}.png`;
  image.alt = posed
    ? `The ${name} from ${rows} directions, one in each row, in ${count} poses`
    : `The ${name} from ${rows} directions`;
  image.loading = 'lazy';
  const caption = document.createElement('figcaption');
  const poses = posed ? ` and the <a href="${name}.poses.json">${count} poses</a>` : '';
  caption.innerHTML = `<code>${name}.png</code>, its <a href="${name}.json">frame list</a> and the <a href="${name}.scene.json">scene</a>${poses} it was drawn from.`;
  figure.append(image, caption);
  list.append(figure);
}

// One pose, as the model wrote it: the axe when it has struck.
const sample = document.getElementById('pose');
if (sample) {
  const poses = await fetch('person.poses.json').then((r) => r.json());
  // A change to a line.
  sample.textContent = `[\n${poses[POSE.struck].map((c) => `  ${JSON.stringify(c)}`).join(',\n')}\n]`;
}
