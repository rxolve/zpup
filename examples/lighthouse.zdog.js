// The lighthouse of lighthouse.ts as a Zdog script: the same solids at the same
// places and sizes. Zdog's rotate.y turns the other way from Zpup's, so those
// angles have the opposite sign. Drawn by compare.ts.
const TAU = Zdog.TAU;
const up = { x: TAU / 4 };
// Zdog has no shading, so each face gets the color Zpup gives it.
const white = '#f4f1ea',
  wall = '#d6d3cd',
  red = '#d8463c',
  ink = '#2f3440';
const ground = 62;
const illo = new Zdog.Illustration({
  element: '.zdog-svg',
  rotate: { x: (-16 * TAU) / 360, y: (-24 * TAU) / 360 },
});
new Zdog.Cylinder({
  addTo: illo,
  translate: { y: ground + 9 },
  rotate: up,
  diameter: 200,
  length: 18,
  stroke: false,
  color: '#8b8378',
  frontFace: '#a8a29a',
  backface: '#8b8378',
});
new Zdog.Hemisphere({
  addTo: illo,
  translate: { x: -62, y: ground, z: 20 },
  rotate: up,
  scale: { z: 0.6 },
  diameter: 44,
  stroke: false,
  color: '#6f6a62',
  backface: '#6f6a62',
});
const tower = new Zdog.Anchor({ addTo: illo, translate: { y: ground } });
const band = (bottom, height, diameter, color, top) =>
  new Zdog.Cylinder({
    addTo: tower,
    translate: { y: bottom - height / 2 },
    rotate: up,
    diameter,
    length: height,
    stroke: false,
    color,
    frontFace: top,
    backface: color,
  });
band(0, 36, 60, wall, white);
band(-36, 36, 54, red, '#e2746d');
band(-72, 36, 48, wall, white);
band(-108, 6, 68, '#393e49', '#676b74');
band(-114, 22, 32, '#f1c560', '#ffd77b');
new Zdog.Hemisphere({
  addTo: tower,
  translate: { y: -136 },
  rotate: up,
  diameter: 36,
  stroke: false,
  color: red,
  backface: red,
});
new Zdog.Cone({
  addTo: tower,
  translate: { y: -154 },
  rotate: up,
  diameter: 6,
  length: 12,
  stroke: false,
  color: ink,
  backface: ink,
});
new Zdog.Rect({
  addTo: tower,
  translate: { y: -11, z: 30.5 },
  width: 14,
  height: 22,
  stroke: 2,
  fill: true,
  color: ink,
});
new Zdog.Rect({
  addTo: tower,
  translate: { y: -88, z: 24.5 },
  width: 8,
  height: 10,
  stroke: 2,
  fill: true,
  color: ink,
});
const hut = new Zdog.Anchor({
  addTo: illo,
  translate: { x: 54, y: ground - 12, z: 10 },
  rotate: { y: (20 * TAU) / 360 },
});
new Zdog.Box({
  addTo: hut,
  width: 30,
  height: 24,
  depth: 26,
  stroke: false,
  color: wall,
  topFace: white,
  frontFace: '#e3e1da',
  rearFace: '#e3e1da',
  leftFace: '#dbd8d2',
  rightFace: '#dbd8d2',
});
new Zdog.Cone({
  addTo: hut,
  translate: { y: -12 },
  rotate: up,
  diameter: 44,
  length: 18,
  stroke: false,
  color: red,
  backface: red,
});
illo.updateRenderGraph();
