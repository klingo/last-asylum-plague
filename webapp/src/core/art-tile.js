/**
 * Where the "tile" of a picture is, from its alpha channel. The game's art is often a rounded rectangle (the tile) with
 * something popping out of it (a chest rising over the tile's top edge), on a transparent canvas that also leaves a
 * little empty space left and right. The hover card shows the tile edge to edge and lets the rest pop out of the card.
 *
 * - The tile is the longest run of rows in which most of the picture's width is opaque; its left and right are the
 *   median ends of those rows, its top the first row, searching upward, where the columns just inside its sides stop
 *   being opaque (the pop-out is wider in the middle, not there).
 * - A picture without a tile has none and is shown whole: a cut-out (a character, a building) has no run of rows that
 *   is wide, tall and straight-sided enough: its shoulders are wide for a few rows but slope, its body is narrow.
 *
 * Pure module (no DOM): `alpha` is the picture's alpha plane, row by row, scaled down to `width` x `height`.
 */

const OPAQUE = 220; // alpha from which a pixel is part of the tile
const ROW_COVER = 0.8; // a row is part of the tile when this share of the picture's width is opaque
const MIN_ROWS = 3; // the tile is at least this many rows (of the scaled-down picture) tall
const MIN_WIDTH = 0.8; // ... and this share of the picture's width wide: narrower is a cut-out, not a tile
const MIN_HEIGHT = 0.3; // ... and this share of its height tall (a cut-out's wide shoulders are a few rows)
const STRAIGHT = 0.9; // ... and this share of its rows end within SIDE_TOLERANCE of the median ends: a slope is no tile
const SIDE_TOLERANCE = 0.03; // (of the picture's width; a rounded corner stays within it)
const EDGE_INSET = 0.1; // the columns that find the tile's top: this share of its width in from its sides

/** `{ left, right, top }` of the tile as shares (0 to 1) of the picture's width / height, or null without one. */
function findTile(alpha, width, height) {
    const opaque = (x, y) => alpha[y * width + x] >= OPAQUE;
    const covered = (y) => {
        let count = 0;
        for (let x = 0; x < width; x++) {
            count += opaque(x, y) ? 1 : 0;
        }
        return count / width >= ROW_COVER;
    };
    let run = null; // the longest run of tile rows: [first, after last]
    let start = -1;
    for (let y = 0; y <= height; y++) {
        const inTile = y < height && covered(y);
        if (inTile && start < 0) {
            start = y;
        } else if (!inTile && start >= 0) {
            run = !run || y - start > run[1] - run[0] ? [start, y] : run;
            start = -1;
        }
    }
    if (!run || run[1] - run[0] < Math.max(MIN_ROWS, MIN_HEIGHT * height)) {
        return null;
    }
    const lefts = [];
    const rights = [];
    for (let y = run[0]; y < run[1]; y++) {
        let left = 0;
        while (!opaque(left, y)) {
            left++;
        }
        let right = width - 1;
        while (!opaque(right, y)) {
            right--;
        }
        lefts.push(left);
        rights.push(right + 1);
    }
    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    const left = median(lefts);
    const right = median(rights);
    const straight = (ends, median) =>
        ends.filter((end) => Math.abs(end - median) <= SIDE_TOLERANCE * width).length / ends.length >= STRAIGHT;
    if ((right - left) / width < MIN_WIDTH || !straight(lefts, left) || !straight(rights, right)) {
        return null;
    }
    const inner = Math.round((right - left) * EDGE_INSET);
    const columns = [left + inner, right - inner - 1];
    const solid = (y) => columns.every((x) => opaque(x, y));
    let top = run[0];
    while (top > 0 && solid(top - 1)) {
        top--;
    }
    return { left: left / width, right: right / width, top: top / height };
}

export { findTile };
