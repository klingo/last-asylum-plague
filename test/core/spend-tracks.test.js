import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestCostForPoints, trackTiers, trackPointsForPrice } from '../../webapp/src/core/spend-tracks.js';

test('spend tracks: tier costs and track points', () => {
    const track = {
        conversions: [
            { price: 99, points: 100 },
            { price: 499, points: 500 },
            { price: 999, points: 1100 },
        ],
        tiers: { 1000: { gem: 1 }, 300: { ore: 5 }, 0: {} },
    };
    // Ten 99-packs (990) beat one 999-pack: the cheapest mix wins, not the biggest pack.
    assert.equal(cheapestCostForPoints(track.conversions, 1000), 990);
    assert.equal(cheapestCostForPoints(track.conversions, 300), 297);
    assert.deepEqual(
        trackTiers(track).map(({ threshold, stepCost, cumulativeCost }) => [threshold, stepCost, cumulativeCost]),
        [
            [300, 297, 297],
            [1000, 693, 990],
        ],
    );
    assert.equal(trackPointsForPrice(track, 499), 500);
    assert.equal(trackPointsForPrice({ conversions: [] }, 1234), 1234);
});
