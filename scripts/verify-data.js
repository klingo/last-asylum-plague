const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Ajv = require('ajv');

const DATA_PATH = path.join(__dirname, '..', 'data', 'pack_data.json');
const SCHEMA_PATH = path.join(__dirname, '..', 'data', 'pack_data.schema.json');
const ITEM_IMAGES_DIR = path.join(__dirname, '..', 'webapp', 'public', 'assets', 'items');

/**
 * Validates data integrity of pack_data.json
 * - JSON Schema compliance (Ajv)
 * - Relational integrity (items, packages, exchange shops)
 * - Package tier ladder gap detection
 * - Drop table probability distributions
 * - Item points fitted from the deal % (webapp/src/lib/point-fit.js) and items whose worth can't be
 *   resolved (webapp/src/lib/item-values.js)
 */
async function verifyData() {
    console.log('Starting Pack Data Verification...\n');

    let totalErrorCount = 0;
    let totalWarningCount = 0;

    // Helper to run checks in a category
    function checkCategory(categoryName, runner) {
        console.log(`Checking ${categoryName}...`);
        const categoryErrors = [];
        const categoryWarnings = [];

        function reportError(type, message) {
            totalErrorCount++;
            categoryErrors.push(`  - [ERROR] [${type}] ${message}`);
        }

        function reportWarning(type, message) {
            totalWarningCount++;
            categoryWarnings.push(`  - [WARN] [${type}] ${message}`);
        }

        runner({ reportError, reportWarning });

        if (categoryErrors.length === 0 && categoryWarnings.length === 0) {
            console.log('  - [OK] No issues found.');
        } else {
            for (const err of categoryErrors) {
                console.log(err);
            }
            for (const warn of categoryWarnings) {
                console.log(warn);
            }
        }
        console.log();
    }

    // 1. File existence and JSON Parsing
    if (!fs.existsSync(DATA_PATH)) {
        console.log(`Checking File System...\n  - [ERROR] [File System] Data file not found at ${DATA_PATH}\n`);
        return finish(1, 0);
    }
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.log(`Checking File System...\n  - [ERROR] [File System] Schema file not found at ${SCHEMA_PATH}\n`);
        return finish(1, 0);
    }

    let data;
    let schema;
    try {
        data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    } catch (err) {
        console.log(`Checking JSON Syntax...\n  - [ERROR] [JSON Parse] Failed to parse ${DATA_PATH}: ${err.message}\n`);
        return finish(1, 0);
    }

    try {
        schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    } catch (err) {
        console.log(
            `Checking JSON Syntax...\n  - [ERROR] [JSON Parse] Failed to parse ${SCHEMA_PATH}: ${err.message}\n`,
        );
        return finish(1, 0);
    }

    // 2. Schema Validation via Ajv
    checkCategory('JSON Schema', ({ reportError }) => {
        const ajv = new Ajv({ allErrors: true });
        const validate = ajv.compile(schema);
        const valid = validate(data);

        if (!valid && validate.errors) {
            for (const err of validate.errors) {
                reportError('Schema', `${err.instancePath || err.dataPath || 'root'} ${err.message}`);
            }
        }
    });

    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = data.exchange_shops || {};
    const events = data.events || {};
    const spendRewardTracks = data.spend_reward_tracks || {};

    const itemKeys = new Set(Object.keys(items));
    const packageKeys = new Set(Object.keys(packages));
    const eventKeys = new Set(Object.keys(events));

    const referencedItemKeys = new Set();
    const referencedEventKeys = new Set();

    // 3. Item-to-Item Relational Checks
    checkCategory('Items & Item Containers', ({ reportError }) => {
        for (const [itemId, item] of Object.entries(items)) {
            // Check fixed contains
            if (item.contains && typeof item.contains === 'object') {
                for (const subItemId of Object.keys(item.contains)) {
                    referencedItemKeys.add(subItemId);
                    if (!itemKeys.has(subItemId)) {
                        reportError('Item Reference', `Item "${itemId}" contains unresolvable item: "${subItemId}"`);
                    }
                    if (subItemId === itemId) {
                        reportError('Item Loop', `Item "${itemId}" directly contains itself.`);
                    }
                }
            }

            // Check image: an item whose image this one borrows, or an image of its own name in
            // webapp/public/assets/items/<category> (or not sorted yet, directly in assets/items), shared by
            // several items, e.g. every rarity of a supply.
            if (item.image) {
                referencedItemKeys.add(item.image);
                const imageFiles = [
                    path.join(ITEM_IMAGES_DIR, item.category || '', `${item.image}.png`),
                    path.join(ITEM_IMAGES_DIR, `${item.image}.png`),
                ];
                if (!itemKeys.has(item.image) && !imageFiles.some((file) => fs.existsSync(file))) {
                    reportError(
                        'Item Reference',
                        `Item "${itemId}" image references neither an item nor an image: "${item.image}"`,
                    );
                }
            }

            // Check crafted_from (recipe: the item can be crafted from these ingredients).
            if (item.crafted_from && typeof item.crafted_from === 'object') {
                for (const subItemId of Object.keys(item.crafted_from)) {
                    referencedItemKeys.add(subItemId);
                    if (!itemKeys.has(subItemId)) {
                        reportError(
                            'Item Reference',
                            `Item "${itemId}" crafted_from references unresolvable item: "${subItemId}"`,
                        );
                    }
                    if (subItemId === itemId) {
                        reportError('Item Loop', `Item "${itemId}" is crafted from itself.`);
                    }
                }
            }

            // Check value_equivalent (valuation-only "worth N of another item" fact, see
            // webapp/src/lib/item-values.js).
            if (item.value_equivalent && typeof item.value_equivalent === 'object') {
                for (const subItemId of Object.keys(item.value_equivalent)) {
                    referencedItemKeys.add(subItemId);
                    if (!itemKeys.has(subItemId)) {
                        reportError(
                            'Item Reference',
                            `Item "${itemId}" value_equivalent references unresolvable item: "${subItemId}"`,
                        );
                    }
                    if (subItemId === itemId) {
                        reportError('Item Loop', `Item "${itemId}" is value-equivalent to itself.`);
                    }
                }
            }

            // Check choice pools
            if (item.choice && Array.isArray(item.choice.choices)) {
                for (let i = 0; i < item.choice.choices.length; i++) {
                    const choice = item.choice.choices[i];
                    for (const subItemId of Object.keys(choice)) {
                        referencedItemKeys.add(subItemId);
                        if (!itemKeys.has(subItemId)) {
                            reportError(
                                'Item Reference',
                                `Item "${itemId}" choice pool option #${i + 1} contains unresolvable item: "${subItemId}"`,
                            );
                        }
                        if (subItemId === itemId) {
                            reportError('Item Loop', `Item "${itemId}" offers itself in choice option #${i + 1}.`);
                        }
                    }
                }
            }

            // Check substitutes_for
            if (Array.isArray(item.substitutes_for)) {
                for (const subItemId of item.substitutes_for) {
                    referencedItemKeys.add(subItemId);
                    if (!itemKeys.has(subItemId)) {
                        reportError(
                            'Item Reference',
                            `Item "${itemId}" substitutes for unresolvable item: "${subItemId}"`,
                        );
                    }
                    if (subItemId === itemId) {
                        reportError('Item Loop', `Item "${itemId}" substitutes for itself.`);
                    }
                }
            } else if (item.substitutes_for && typeof item.substitutes_for === 'object') {
                for (const subItemId of Object.keys(item.substitutes_for)) {
                    referencedItemKeys.add(subItemId);
                    if (!itemKeys.has(subItemId)) {
                        reportError(
                            'Item Reference',
                            `Item "${itemId}" substitutes for unresolvable item: "${subItemId}"`,
                        );
                    }
                    if (subItemId === itemId) {
                        reportError('Item Loop', `Item "${itemId}" substitutes for itself.`);
                    }
                }
            }

            // Check random drop tables
            if (item.drop_table && Array.isArray(item.drop_table)) {
                let totalProbability = 0;
                for (let i = 0; i < item.drop_table.length; i++) {
                    const drop = item.drop_table[i];
                    if (typeof drop.probability === 'number') {
                        totalProbability += drop.probability;
                    }
                    if (drop.contains && typeof drop.contains === 'object') {
                        for (const subItemId of Object.keys(drop.contains)) {
                            referencedItemKeys.add(subItemId);
                            if (!itemKeys.has(subItemId)) {
                                reportError(
                                    'Item Reference',
                                    `Item "${itemId}" drop table entry #${i + 1} contains unresolvable item: "${subItemId}"`,
                                );
                            }
                        }
                    }
                }

                // Probability sum check (allowing small float precision delta)
                if (Math.abs(totalProbability - 1.0) > 0.001) {
                    reportError(
                        'Probability',
                        `Item "${itemId}" drop table probabilities sum to ${totalProbability.toFixed(5)} (expected 1.0)`,
                    );
                }
            }
        }
    });

    // 4. Package Relational Checks
    checkCategory('Packages & Package Prerequisites', ({ reportError, reportWarning }) => {
        function checkContains(label, contains) {
            if (!contains || typeof contains !== 'object') {
                return;
            }
            for (const itemId of Object.keys(contains)) {
                referencedItemKeys.add(itemId);
                if (!itemKeys.has(itemId)) {
                    reportError('Package Reference', `${label} contains unresolvable item: "${itemId}"`);
                }
            }
        }

        function checkChoice(label, choice) {
            if (!choice || !Array.isArray(choice.choices)) {
                return;
            }
            for (let i = 0; i < choice.choices.length; i++) {
                for (const itemId of Object.keys(choice.choices[i])) {
                    referencedItemKeys.add(itemId);
                    if (!itemKeys.has(itemId)) {
                        reportError(
                            'Package Reference',
                            `${label} choice option #${i + 1} contains unresolvable item: "${itemId}"`,
                        );
                    }
                }
            }
        }

        for (const [pkgId, pkg] of Object.entries(packages)) {
            if (pkg.event_id) {
                referencedEventKeys.add(pkg.event_id);
                if (!eventKeys.has(pkg.event_id)) {
                    reportError(
                        'Package Reference',
                        `Package "${pkgId}" specifies unresolvable event: "${pkg.event_id}"`,
                    );
                }
            }

            if (pkg.tiers && typeof pkg.tiers === 'object') {
                // Package family: each tier owns its own contains/choice.
                const tierNums = Object.keys(pkg.tiers)
                    .map(Number)
                    .sort((a, b) => a - b);
                for (const [tierNum, tier] of Object.entries(pkg.tiers)) {
                    const label = `Package "${pkgId}" tier ${tierNum}`;
                    checkContains(label, tier.contains);
                    checkChoice(label, tier.choice);
                }

                // Gaps in the tier ladder (e.g. tier 1-4 missing while only tier 5 exists,
                // or tier 3 missing while tiers 1-2 and 4-5 exist) are allowed for
                // not-yet-documented tiers, but worth flagging.
                if (tierNums.length > 0) {
                    const max = tierNums[tierNums.length - 1];
                    const present = new Set(tierNums);
                    const missing = [];
                    for (let i = 1; i <= max; i++) {
                        if (!present.has(i)) {
                            missing.push(i);
                        }
                    }
                    if (missing.length > 0) {
                        reportWarning(
                            'Package Tier Gap',
                            `Package "${pkgId}" tier ladder is missing tier(s) ${missing.join(', ')} (present: ${tierNums.join(', ')}).`,
                        );
                    }
                }
            } else {
                checkContains(`Package "${pkgId}"`, pkg.contains);
                checkChoice(`Package "${pkgId}"`, pkg.choice);
            }
        }

        // `bundles`: the packages a bundle already includes (Weekly Pass -> single passes) must exist.
        for (const [pkgId, pkg] of Object.entries(packages)) {
            if (pkg.icon && !itemKeys.has(pkg.icon)) {
                reportError('Package Reference', `Package "${pkgId}" has an unknown icon item: "${pkg.icon}"`);
            }
            for (const includedId of pkg.bundles || []) {
                if (!packageKeys.has(includedId)) {
                    reportError(
                        'Package Reference',
                        `Package "${pkgId}" bundles unresolvable package: "${includedId}"`,
                    );
                }
                if (includedId === pkgId) {
                    reportError('Package Loop', `Package "${pkgId}" bundles itself.`);
                }
            }
        }

        // Mutually exclusive groups (only one member can be bought): need at least two members that
        // share the same event and limit type, or "one of them" means nothing.
        const groups = new Map();
        for (const [pkgId, pkg] of Object.entries(packages)) {
            if (pkg.exclusive_group) {
                if (!groups.has(pkg.exclusive_group)) {
                    groups.set(pkg.exclusive_group, []);
                }
                groups.get(pkg.exclusive_group).push([pkgId, pkg]);
            }
        }
        for (const [groupId, members] of groups) {
            if (members.length < 2) {
                reportWarning('Exclusive Group', `Group "${groupId}" has only one package (${members[0][0]}).`);
            }
            const signatures = new Set(members.map(([, pkg]) => `${pkg.event_id || ''}|${pkg.limit_type || ''}`));
            if (signatures.size > 1) {
                reportError(
                    'Exclusive Group',
                    `Group "${groupId}" mixes events/limit types: ${members.map(([id]) => id).join(', ')}.`,
                );
            }
        }
    });

    // 5. Exchange Shop Relational Checks
    checkCategory('Exchange Shops', ({ reportError }) => {
        for (const [shopId, shop] of Object.entries(exchangeShops)) {
            if (shop.event_id) {
                referencedEventKeys.add(shop.event_id);
                if (!eventKeys.has(shop.event_id)) {
                    reportError(
                        'Shop Reference',
                        `Exchange shop "${shopId}" specifies unresolvable event: "${shop.event_id}"`,
                    );
                }
            }

            if (shop.currency_item_id) {
                referencedItemKeys.add(shop.currency_item_id);
                if (!itemKeys.has(shop.currency_item_id)) {
                    reportError(
                        'Shop Reference',
                        `Exchange shop "${shopId}" specifies unresolvable currency item: "${shop.currency_item_id}"`,
                    );
                }
            }

            if (shop.offers && typeof shop.offers === 'object') {
                for (const [offerKey, offer] of Object.entries(shop.offers)) {
                    const offerItemId = offer.item_id || offerKey;
                    referencedItemKeys.add(offerItemId);
                    if (!itemKeys.has(offerItemId)) {
                        reportError(
                            'Shop Reference',
                            `Exchange shop "${shopId}" offer "${offerKey}" specifies unresolvable item: "${offerItemId}"`,
                        );
                    }
                }
            }

            const pointCurrency = shop.point_purchase?.currency_item_id;
            if (pointCurrency) {
                referencedItemKeys.add(pointCurrency);
                if (!itemKeys.has(pointCurrency)) {
                    reportError(
                        'Shop Reference',
                        `Exchange shop "${shopId}" point_purchase uses unresolvable currency: "${pointCurrency}"`,
                    );
                }
            }

            if (shop.bonus_tiers && typeof shop.bonus_tiers === 'object') {
                for (const [tier, contents] of Object.entries(shop.bonus_tiers)) {
                    if (!contents || typeof contents !== 'object') {
                        continue;
                    }
                    for (const itemId of Object.keys(contents)) {
                        referencedItemKeys.add(itemId);
                        if (!itemKeys.has(itemId)) {
                            reportError(
                                'Shop Reference',
                                `Exchange shop "${shopId}" bonus tier "${tier}" contains unresolvable item: "${itemId}"`,
                            );
                        }
                    }
                }
            }
        }
    });

    // 6. Spend Reward Track Relational Checks
    checkCategory('Spend Reward Tracks', ({ reportError }) => {
        for (const [trackId, track] of Object.entries(spendRewardTracks)) {
            for (const [threshold, contains] of Object.entries(track.tiers || {})) {
                if (!contains || typeof contains !== 'object') {
                    continue;
                }
                for (const itemId of Object.keys(contains)) {
                    referencedItemKeys.add(itemId);
                    if (!itemKeys.has(itemId)) {
                        reportError(
                            'Spend Reward Reference',
                            `Spend reward track "${trackId}" tier "${threshold}" contains unresolvable item: "${itemId}"`,
                        );
                    }
                }
            }
        }
    });

    // 7. Events Relational Checks
    checkCategory('Events', ({ reportWarning }) => {
        for (const eventId of eventKeys) {
            // In-game events (category "ingame_event") have no packs or shop on purpose.
            if (!referencedEventKeys.has(eventId) && events[eventId].category !== 'ingame_event') {
                reportWarning(
                    'Unreferenced Event',
                    `Event "${eventId}" (${events[eventId].name.en}) is defined but never referenced by any package or exchange shop.`,
                );
            }
        }
    });

    // 7b. Schedule (runs of events / seasonal passes / spend tracks, inclusive start/end dates)
    checkCategory('Schedule', ({ reportError }) => {
        for (const [id, runs] of Object.entries(data.schedule || {})) {
            if (!events[id] && !packages[id]?.seasonal && !spendRewardTracks[id]) {
                reportError(
                    'Schedule Reference',
                    `Schedule lists "${id}", which is no event, seasonal pass or spend reward track.`,
                );
            }
            let previous = null;
            for (const run of [...runs].sort((a, b) => a.start.localeCompare(b.start))) {
                for (const date of [run.start, run.end]) {
                    if (!isRealDate(date)) {
                        reportError('Schedule Dates', `"${id}": ${date} is not a valid date.`);
                    }
                }
                if (run.end < run.start) {
                    reportError('Schedule Dates', `"${id}": run ${run.start}..${run.end} ends before it starts.`);
                }
                if (previous && run.start <= previous.end) {
                    reportError(
                        'Schedule Dates',
                        `"${id}": runs ${previous.start}..${previous.end} and ${run.start}..${run.end} overlap.`,
                    );
                }
                previous = run;
            }
        }
    });

    // 8. Report Unreferenced Items (Informational / Warnings)
    checkCategory('Unreferenced Items', ({ reportWarning }) => {
        for (const itemId of itemKeys) {
            if (!referencedItemKeys.has(itemId)) {
                reportWarning(
                    'Unreferenced Item',
                    `Item "${itemId}" (${items[itemId].name.en}) is defined but never referenced anywhere.`,
                );
            }
        }
    });

    // 8b. Squad guides (Gear Path page): heroes, slots and gear exist, and every path step is possible at its
    // point (webapp/src/lib/gear-path.js: crafted first, level caps by stars, minimum levels for stars).
    const gearPath = await import(
        pathToFileURL(path.join(__dirname, '..', 'webapp', 'src', 'lib', 'gear-path.js')).href
    );
    checkCategory('Squad Guides', ({ reportError, reportWarning }) => {
        const heroes = data.heroes || {};
        for (const [heroId, hero] of Object.entries(heroes)) {
            const image = path.join(__dirname, '..', 'webapp', 'public', 'assets', 'heroes', `${hero.image}.png`);
            if (!fs.existsSync(image)) {
                reportError(
                    'Hero Image',
                    `Hero "${heroId}" has no image "${hero.image}" (webapp/public/assets/heroes/${hero.image}.png).`,
                );
            }
        }
        for (const [setId, gearSet] of Object.entries(data.gear_upgrades || {})) {
            const costItems = [
                ...Object.values(gearSet.level_costs || {}),
                ...Object.values(gearSet.star_costs || {}),
            ].flatMap((costs) => Object.keys(costs));
            const blueprintItems = Object.values(gearSet.blueprints || {});
            for (const itemId of new Set([
                ...gearSet.items,
                ...gearSet.layout.flat(),
                ...costItems,
                ...blueprintItems,
            ])) {
                if (!items[itemId]) {
                    reportError('Gear Reference', `Gear set "${setId}" references unknown item "${itemId}".`);
                }
            }
            const laidOut = gearSet.layout.flat();
            if (laidOut.length !== gearSet.items.length || gearSet.items.some((itemId) => !laidOut.includes(itemId))) {
                reportError('Gear Layout', `Gear set "${setId}": its layout must show each of its items exactly once.`);
            }
        }
        // A problem without its piece, so the same problem of many pieces of one step is reported once.
        const describe = (p) => {
            switch (p.code) {
                case 'levelCap':
                    return `can only reach Lv ${p.cap} at ${p.stars} stars`;
                case 'starNeedsLevel':
                    return `needs Lv ${p.level} to work toward star ${p.star}`;
                case 'notCrafted':
                    return 'not crafted (missing in the crafting path)';
                case 'alreadyCrafted':
                    return 'crafted twice';
                case 'noEffect':
                    return 'changes nothing (every piece is already there)';
                default:
                    return p.code;
            }
        };
        const PATH_NAMES = { craft: 'crafting', level: 'level', stars: 'star' };
        const piecesText = (pieces) =>
            pieces.length > 3 ? `${pieces.slice(0, 3).join(', ')} and ${pieces.length - 3} more` : pieces.join(', ');
        for (const [guideId, guide] of Object.entries(data.squad_guides || {})) {
            const gearSet = data.gear_upgrades?.[guide.gear];
            if (!gearSet) {
                reportError('Squad Guide', `Squad guide "${guideId}" uses unknown gear set "${guide.gear}".`);
                continue;
            }
            const formation = [...guide.formation.front, ...guide.formation.back];
            const slots = Object.keys(guide.slots);
            if (
                formation.length !== slots.length ||
                slots.some((slot) => formation.filter((s) => s === slot).length !== 1)
            ) {
                reportError(
                    'Squad Guide',
                    `Squad guide "${guideId}": the formation must place each slot exactly once.`,
                );
            }
            // Each slot's hero per faction: known, of the slot's class and of that faction. A faction the page offers
            // needs a hero in every slot.
            const factions = new Set(Object.values(guide.slots).flatMap((s) => Object.keys(s.heroes || {})));
            for (const [slot, { heroes: byFaction = {}, class: heroClass }] of Object.entries(guide.slots)) {
                for (const faction of factions) {
                    const hero = byFaction[faction];
                    if (!hero) {
                        reportWarning(
                            'Squad Guide',
                            `Squad guide "${guideId}", slot "${slot}": no ${faction} hero (the page leaves out the ${faction}s).`,
                        );
                    } else if (!heroes[hero]) {
                        reportError('Squad Guide', `Squad guide "${guideId}", slot "${slot}": unknown hero "${hero}".`);
                    } else if (heroes[hero].class !== heroClass) {
                        reportWarning(
                            'Squad Guide',
                            `Squad guide "${guideId}", slot "${slot}" (${heroClass}): ${hero} is a ${heroes[hero].class}.`,
                        );
                    } else if (heroes[hero].faction !== faction) {
                        reportError(
                            'Squad Guide',
                            `Squad guide "${guideId}", slot "${slot}": ${hero} is listed as ${faction} but is a ${heroes[hero].faction}.`,
                        );
                    }
                }
            }
            // The three paths merged as on the page: a step that's never possible (e.g. Lv 60 while the star path
            // never reaches 4 stars, or a piece the crafting path never crafts) keeps its problems.
            for (const entry of gearPath.mergePaths(guide, gearSet)) {
                const byProblem = new Map();
                for (const problem of entry.problems) {
                    const text = describe(problem);
                    byProblem.set(text, [
                        ...(byProblem.get(text) || []),
                        ...(problem.slot ? [`${problem.slot} ${problem.item ?? ''}`.trim()] : []),
                    ]);
                }
                for (const [text, pieces] of byProblem) {
                    reportError(
                        'Gear Path',
                        `Squad guide "${guideId}", ${PATH_NAMES[entry.path]} path step ${entry.n + 1}: ${text}${pieces.length ? ` (${piecesText(pieces)})` : ''}.`,
                    );
                }
            }
        }
    });

    // 9. Points fitted from the deal % (webapp/src/lib/point-fit.js), and items whose worth can't
    // be resolved from them (not in any pack with a deal %, and nothing to derive one from).
    // Currencies are valued by what they buy, so they're skipped here.
    const libDir = path.join(__dirname, '..', 'webapp', 'src', 'lib');
    const { fitItemPoints, fitSensitivity, isDependent } = await import(
        pathToFileURL(path.join(libDir, 'point-fit.js')).href
    );
    const { resolveItemValues } = await import(pathToFileURL(path.join(libDir, 'item-values.js')).href);
    const { currencyItemIds } = await import(pathToFileURL(path.join(libDir, 'catalog.js')).href);
    const fit = fitItemPoints(data);
    const { diagnostics } = fit;
    const percent = (value) => `${(value * 100).toFixed(1)}%`;
    console.log('Fitting Item Points from Deal %...');
    console.log(
        `  - ${diagnostics.parameters} values from ${diagnostics.equations} equations; packs match within ${percent(diagnostics.medianError)} (median), ${percent(diagnostics.p90Error)} (90th percentile).`,
    );
    const worst = [...diagnostics.packages].sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)).slice(0, 5);
    console.log(`  - Furthest off: ${worst.map((p) => `${p.id} (${p.ratio.toFixed(2)}x)`).join(', ')}`);
    const uncertain = [...fit.points].filter(([, entry]) => entry.uncertain).map(([id]) => id);
    console.log(`  - Uncertain (barely determined by the packs): ${uncertain.join(', ') || 'none'}`);
    const sensitivity = fitSensitivity(data, fit);
    const dependent = [...sensitivity]
        .filter(([, s]) => isDependent(s))
        .sort((a, b) => b[1].factor - a[1].factor)
        .map(
            ([id, s]) =>
                `${id} (${Number.isFinite(s.factor) ? `x${s.factor.toFixed(1)} without` : 'only from'} ${s.family})`,
        );
    console.log(`  - Depends on a single pack: ${dependent.join(', ') || 'none'}\n`);

    const currencyIds = currencyItemIds(exchangeShops);
    const zeroCurrencies = Object.fromEntries([...currencyIds].map((id) => [id, 0]));
    const resolved = resolveItemValues(items, { basePoints: fit.points, currencyIds, currencyValues: zeroCurrencies });
    checkCategory('Item Worth', ({ reportWarning }) => {
        for (const [itemId, entry] of resolved) {
            if (!items[itemId]) {
                continue; // unresolvable references are reported above
            }
            if (entry.value === null) {
                reportWarning(
                    'Unknown Worth',
                    `Item "${itemId}" (${items[itemId].name.en}) is in no pack with a deal % and has nothing to derive a worth from.`,
                );
            } else if (entry.incomplete) {
                reportWarning(
                    'Partial Worth',
                    `Item "${itemId}" (${items[itemId].name.en}) contains items of unknown worth.`,
                );
            }
        }
    });

    return finish(totalErrorCount, totalWarningCount, {
        totalItems: itemKeys.size,
        totalPackages: packageKeys.size,
        totalShops: Object.keys(exchangeShops).length,
        totalEvents: eventKeys.size,
    });
}

function finish(errorCount, warningCount, stats = {}) {
    console.log('=======================================================');
    console.log('Verification Summary:');
    if (stats.totalItems !== undefined) {
        console.log(`   - Items Scanned: ${stats.totalItems}`);
        console.log(`   - Packages Scanned: ${stats.totalPackages}`);
        console.log(`   - Exchange Shops Scanned: ${stats.totalShops}`);
        console.log(`   - Events Scanned: ${stats.totalEvents}`);
    }
    console.log(`   - Total Errors: ${errorCount}`);
    console.log(`   - Total Warnings: ${warningCount}`);
    console.log('=======================================================');

    if (errorCount > 0) {
        console.log(`\nVerification FAILED with ${errorCount} error(s). Please resolve the broken references above.\n`);
        process.exit(1);
    } else if (warningCount > 0) {
        console.log(
            `\nVerification PASSED with ${warningCount} warning(s). All references and dependencies are resolved.\n`,
        );
        process.exit(0);
    } else {
        console.log('\nVerification PASSED! All references and dependencies are fully resolved.\n');
        process.exit(0);
    }
}

verifyData().catch((error) => {
    console.error(error);
    process.exit(1);
});

/** True for an existing "YYYY-MM-DD" date (not e.g. 2026-02-30). */
function isRealDate(text) {
    const [year, month, date] = String(text).split('-').map(Number);
    const day = new Date(Date.UTC(year, month - 1, date));
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}
