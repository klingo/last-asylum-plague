import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTile } from '../../webapp/src/core/art-tile.js';

/** An alpha plane of `width` x `height`, transparent except the rectangles given as [left, top, right, bottom] (opaque). */
function plane(width, height, ...rectangles) {
    const alpha = new Uint8Array(width * height);
    for (const [left, top, right, bottom] of rectangles) {
        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
                alpha[y * width + x] = 255;
            }
        }
    }
    return alpha;
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('a picture that is opaque all over is one tile', () => {
    assert.deepEqual(findTile(plane(100, 50, [0, 0, 100, 50]), 100, 50), { left: 0, right: 1, top: 0 });
});

test('empty space left and right of the tile is cut away', () => {
    const tile = findTile(plane(100, 50, [4, 0, 96, 50]), 100, 50);
    near(tile.left, 0.04);
    near(tile.right, 0.96);
    assert.equal(tile.top, 0);
});

test('what pops out above the tile is not part of it: the tile starts at its own top edge', () => {
    // a tile from row 20 to 80 of 100, 4..96 wide, with a chest (narrow) rising from row 5 to the tile's top
    const tile = findTile(plane(100, 100, [4, 20, 96, 80], [30, 5, 70, 20]), 100, 100);
    near(tile.left, 0.04);
    near(tile.right, 0.96);
    near(tile.top, 0.2);
});

test('a pop-out inside the side columns does not move the tile edge up', () => {
    // a thin spike right above the tile's centre only
    const tile = findTile(plane(100, 100, [4, 40, 96, 100], [48, 0, 52, 40]), 100, 100);
    near(tile.top, 0.4);
});

test('a narrow shape (a cut-out character) is no tile, and neither is an empty or tiny picture', () => {
    assert.equal(findTile(plane(100, 100, [30, 0, 70, 100]), 100, 100), null);
    assert.equal(findTile(new Uint8Array(100 * 100), 100, 100), null);
    assert.equal(findTile(plane(100, 100, [0, 50, 100, 52]), 100, 100), null); // 2 rows are too few
});

test('a cut-out with wide shoulders at its bottom is no tile (a few wide rows, not a tall run)', () => {
    // a head (narrow, rows 0-85) over shoulders that span 82% of the width for the last 14 rows
    assert.equal(findTile(plane(100, 100, [40, 0, 60, 86], [8, 86, 90, 100]), 100, 100), null);
});

test('a tall, wide shape with sloping sides is no tile', () => {
    const rows = [];
    for (let y = 20; y < 100; y++) {
        const inset = Math.round((100 - y) * 0.15); // 12 px in at the top of the run, none at the bottom
        rows.push([inset, y, 100 - inset, y + 1]);
    }
    assert.equal(findTile(plane(100, 100, ...rows), 100, 100), null);
});

test('rounded corners (a tile a bit narrower in its first and last rows) still give the full width', () => {
    const rows = [];
    for (let y = 0; y < 40; y++) {
        const inset = y < 3 ? 3 - y : y >= 37 ? y - 36 : 0;
        rows.push([inset, y, 100 - inset, y + 1]);
    }
    const tile = findTile(plane(100, 40, ...rows), 100, 40);
    assert.equal(tile.left, 0);
    assert.equal(tile.right, 1);
});
