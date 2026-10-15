import test from 'node:test';
import assert from 'node:assert/strict';
import { createAreaWorkbenchClass } from '../scripts/area-workbench.mjs';
import { distanceInYards } from '../scripts/fragmentation-workbench.mjs';

// Coordinate accessors need not be own enumerable object properties.
class Point {
  constructor(x, y) {
    this._x = x;
    this._y = y;
  }
  get x() {
    return this._x;
  }
  get y() {
    return this._y;
  }
}
globalThis.game = { settings: { get: () => 'public' } };
const scene = { id: 's', grid: { units: 'yards' } };
globalThis.canvas = {
  ready: true,
  scene,
  grid: {
    measurePath: ([a, b]) => {
      // The shared helper measures a 2D path, then adds elevation itself.
      // Passing elevation on only one waypoint changes the grid API contract.
      assert.equal('elevation' in a, false);
      assert.equal('elevation' in b, false);
      assert.equal('sceneId' in a, false);
      return { euclidean: Math.hypot(b.x - a.x, b.y - a.y) };
    },
  },
};
const Area = createAreaWorkbenchClass(class {});
const recipient = (key, x, y, elevation = 0) => ({
  key,
  name: key,
  token: { center: new Point(x, y) },
  document: { parent: scene, elevation },
});
test('area origin reads coordinates like fragmentation, including inherited point accessors', () => {
  const a = recipient('a', 10, 20),
    b = recipient('b', 13, 24);
  assert.equal(distanceInYards(a, b), 5);
  const app = new Area([a, b]);
  app.originKey = 'a';
  app.estimate();
  assert.equal(app.rows.a.distance, '0');
  assert.equal(app.rows.b.distance, '5');
  app.rows.b.edited = true;
  app.rows.b.distance = '7';
  app.estimate();
  assert.equal(app.rows.b.distance, '7');
});
test('area measurements retain elevation and explicit template coordinates', () => {
  const a = recipient('a', 0, 0),
    b = recipient('b', 3, 4, 12);
  const app = new Area([a, b], {}, { origin: { x: 0, y: 0, sceneId: 's', elevation: 0 } });
  assert.equal(app.rows.b.distance, '13');
});
