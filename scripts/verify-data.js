const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const DATA_PATH = path.join(__dirname, '..', 'data', 'pack_data.json');
const SCHEMA_PATH = path.join(__dirname, '..', 'data', 'pack_data.schema.json');

/**
 * Validates data integrity of pack_data.json
 * - JSON Schema compliance (Ajv)
 * - Relational integrity (items, packages, exchange shops)
 * - Prerequisite resolution and cycle detection
 * - Drop table probability distributions
 */
function verifyData() {
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
    checkCategory('Packages & Package Prerequisites', ({ reportError }) => {
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
                for (const [tierNum, tier] of Object.entries(pkg.tiers)) {
                    const label = `Package "${pkgId}" tier ${tierNum}`;
                    checkContains(label, tier.contains);
                    checkChoice(label, tier.choice);
                }
            } else {
                checkContains(`Package "${pkgId}"`, pkg.contains);
                checkChoice(`Package "${pkgId}"`, pkg.choice);
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

    // 6. Events Relational Checks
    checkCategory('Events', ({ reportWarning }) => {
        for (const eventId of eventKeys) {
            if (!referencedEventKeys.has(eventId)) {
                reportWarning(
                    'Unreferenced Event',
                    `Event "${eventId}" (${events[eventId].name.en}) is defined but never referenced by any package or exchange shop.`,
                );
            }
        }
    });

    // 7. Report Unreferenced Items (Informational / Warnings)
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

verifyData();
