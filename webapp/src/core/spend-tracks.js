/**
 * Cumulative spend-reward tracks (`spend_reward_tracks` in pack_data.json): the Banknote cost of
 * each tier step. Valuing the rewards is up to the caller (see valuation.js).
 */

/**
 * Cheapest Banknote spend to earn AT LEAST `targetPoints` of an event's spend-tracking currency,
 * given its freely repeatable `conversions` (`{price, points}` denominations). Unbounded
 * coin-change "at least N" recurrence; overshooting with one big denomination is allowed.
 */
function cheapestCostForPoints(conversions, targetPoints) {
    if (!Number.isFinite(targetPoints) || targetPoints <= 0) {
        return 0;
    }
    const dp = new Array(targetPoints + 1).fill(Infinity);
    dp[0] = 0;
    for (let points = 1; points <= targetPoints; points++) {
        for (const conversion of conversions) {
            const reachedFrom = dp[Math.max(0, points - conversion.points)];
            if (reachedFrom + conversion.price < dp[points]) {
                dp[points] = reachedFrom + conversion.price;
            }
        }
    }
    return dp[targetPoints];
}

/**
 * Tiers of one track in threshold order: `{ threshold, stepPoints, stepCost, cumulativeCost,
 * rewards }`. Without `conversions`, thresholds are Banknotes directly.
 */
function trackTiers(track) {
    const conversions = Array.isArray(track.conversions) && track.conversions.length > 0 ? track.conversions : null;
    const thresholds = Object.keys(track.tiers || {})
        .map(Number)
        .filter((threshold) => threshold > 0)
        .sort((a, b) => a - b);
    let previous = 0;
    let cumulativeCost = 0;
    return thresholds.map((threshold) => {
        const stepPoints = threshold - previous;
        previous = threshold;
        const stepCost = conversions ? cheapestCostForPoints(conversions, stepPoints) : stepPoints;
        cumulativeCost += stepCost;
        return { threshold, stepPoints, stepCost, cumulativeCost, rewards: track.tiers[String(threshold)] };
    });
}

/**
 * Track points earned by spending `price` Banknotes on one purchase: the matching conversion, else
 * the track's typical points per Banknote (thresholds are Banknotes directly without conversions).
 */
function trackPointsForPrice(track, price) {
    const conversions = Array.isArray(track.conversions) ? track.conversions : [];
    if (conversions.length === 0) {
        return price;
    }
    const exact = conversions.find((conversion) => conversion.price === price);
    if (exact) {
        return exact.points;
    }
    const rates = conversions.map((conversion) => conversion.points / conversion.price).sort((a, b) => a - b);
    return price * rates[Math.floor(rates.length / 2)];
}

export { cheapestCostForPoints, trackTiers, trackPointsForPrice };
