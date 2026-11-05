import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgress } from '../webapp/src/core/gear-progress.js';
import { loadFixture } from './helpers.js';

const data = loadFixture();
const guide = data.squad_guides.default;
const gearSet = data.gear_upgrades[guide.gear];
const fresh = () => createProgress(guide, gearSet);
const total = (progress) => progress.doneCount('craft') + progress.doneCount('level') + progress.doneCount('stars');

test('a fresh progress has nothing done and only crafting open', () => {
    const progress = fresh();
    assert.equal(total(progress), 0);
    assert.equal(progress.craftComplete(), false);
    assert.equal(progress.nextOf('craft').n, 0);
    assert.equal(progress.canAdvance('craft'), true);
    assert.equal(progress.canAdvance('level'), false, 'levels wait for the crafting');
    assert.equal(progress.canAdvance('stars'), false, 'stars wait for the crafting');
    assert.equal(progress.canUndo('craft'), false);
    assert.equal(progress.mrOnHold, false);
});

test('doing every step in the merged order completes the guide, undoing takes it back', () => {
    const progress = fresh();
    for (const entry of progress.merged) {
        assert.equal(progress.canDo(entry), true, `step ${entry.path}:${entry.n} can be done in the merged order`);
        progress.advance(entry.path, 1);
        assert.equal(progress.isDone(entry), true);
    }
    assert.equal(total(progress), progress.merged.length);
    assert.equal(progress.canAdvance('level') || progress.canAdvance('stars'), false);

    // Undo the last steps again: the last one done in each queue, as far as nothing depends on it.
    const last = progress.merged.at(-1);
    assert.equal(progress.canUndoEntry(last), true);
    progress.advance(last.path, -1);
    assert.equal(progress.isDone(last), false);
    assert.equal(total(progress), progress.merged.length - 1);
});

test('crafting cannot be undone once something is upgraded; an upgrade not while another step needs it', () => {
    const progress = fresh();
    progress.craftAll();
    assert.equal(progress.craftComplete(), true);
    assert.equal(progress.canUndo('craft'), true, 'nothing upgraded yet');
    const upgrade = progress.merged.find((entry) => entry.kind !== 'craft' && progress.canDo(entry));
    progress.advance(upgrade.path, 1);
    assert.equal(progress.canUndo('craft'), false);
    // A step that needs the one just done keeps it in place.
    const dependent = progress.merged.find(
        (entry) => entry.needs && entry.needs.path === upgrade.path && entry.needs.n === upgrade.n,
    );
    if (dependent) {
        assert.equal(progress.canDo(dependent), true);
        progress.advance(dependent.path, 1);
        assert.equal(progress.canUndoEntry(upgrade), false);
    }
});

test('snapshot and load round-trip; impossible progress is dropped on load', () => {
    const progress = fresh();
    for (const entry of progress.merged.slice(0, progress.entriesOf.craft.length + 2)) {
        progress.advance(entry.path, 1);
    }
    const saved = progress.snapshot();
    const again = fresh();
    again.load(saved);
    assert.deepEqual(again.snapshot(), saved);

    // Upgrades saved without the crafting done cannot stand.
    const broken = fresh();
    broken.load({ craft: [0], level: [0, 1], stars: [0] });
    assert.deepEqual(broken.snapshot().level, []);
    assert.deepEqual(broken.snapshot().stars, []);
    assert.deepEqual(broken.snapshot().craft, [0]);

    // Out-of-range and repeated entries are ignored.
    const messy = fresh();
    messy.load({ craft: [0, 0, 999, -1, 1.5] });
    assert.deepEqual(messy.snapshot().craft, [0]);
});

test('older saves stored a count: the first n steps', () => {
    const progress = fresh();
    progress.load({ craft: 3 });
    assert.deepEqual(progress.snapshot().craft, [0, 1, 2]);
    progress.load();
    assert.equal(total(progress), 0);
});

test('a click on a step in a full list marks the steps before it done and those after it undone', () => {
    const progress = fresh();
    progress.jumpTo('craft', 3);
    assert.deepEqual(progress.snapshot().craft, [0, 1, 2]);
    progress.jumpTo('craft', 1);
    assert.deepEqual(progress.snapshot().craft, [0]);
    progress.startOver();
    assert.equal(total(progress), 0);
});

test('the MR switch holds the 5 star steps back', () => {
    const progress = fresh();
    const mrSteps = progress.entriesOf.stars.filter((entry) => progress.isMrStep(entry));
    progress.craftAll();
    progress.setMrOnHold(true);
    assert.equal(progress.mrOnHold, true);
    assert.equal(progress.snapshot().mrOnHold, true);
    for (const entry of mrSteps) {
        assert.equal(progress.isHeld(entry), true);
        assert.notEqual(progress.nextOf('stars'), entry);
    }
    progress.setMrOnHold(false);
    assert.ok(mrSteps.every((entry) => !progress.isHeld(entry)));
    // The switch survives "Start over".
    progress.setMrOnHold(true);
    progress.startOver();
    assert.equal(progress.mrOnHold, true);
});
