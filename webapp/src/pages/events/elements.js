// The page's DOM elements (looked up when the module loads; the HTML is parsed by then).
// One tab per ticked event and per shop without event (VIP Shop): usually only a few, so one click each.
const eventTabs = document.getElementById('event-tabs');
const chooseEvents = document.getElementById('choose-events');
const extraCurrencyField = document.getElementById('extra-currency-field');
const extraCurrencyLabel = document.getElementById('extra-currency-label');
const extraCurrencyInput = document.getElementById('extra-currency');
const extraBanknotesField = document.getElementById('extra-banknotes-field');
const extraBanknotesInput = document.getElementById('extra-banknotes');
const minePickaxesField = document.getElementById('mine-pickaxes-field');
const minePickaxesInput = document.getElementById('mine-pickaxes');
const mineFloorField = document.getElementById('mine-floor-field');
const mineFloorInput = document.getElementById('mine-floor');
const promptCard = document.getElementById('event-prompt-card');
const planCard = document.getElementById('plan-card');
const eventBanner = document.getElementById('event-banner');
const lockNote = document.getElementById('lock-note');
const eventSummary = document.getElementById('event-summary');
const packsSection = document.getElementById('packs-section');
const packsTable = document.getElementById('packs-table');
const shopSection = document.getElementById('shop-section');
const shopHeading = document.getElementById('shop-heading');
const shopNote = document.getElementById('shop-note');
const shopTable = document.getElementById('shop-table');
const mineSection = document.getElementById('mine-section');
const mineHeading = document.getElementById('mine-heading');
const mineTable = document.getElementById('mine-table');
const mineRules = document.getElementById('mine-rules');
const stepsCard = document.getElementById('steps-card');
const stepsTable = document.getElementById('steps-table');
const stepsNote = document.getElementById('steps-note');

export {
    chooseEvents,
    eventBanner,
    eventSummary,
    eventTabs,
    extraBanknotesField,
    extraBanknotesInput,
    extraCurrencyField,
    extraCurrencyInput,
    extraCurrencyLabel,
    lockNote,
    mineFloorField,
    mineFloorInput,
    mineHeading,
    minePickaxesField,
    minePickaxesInput,
    mineRules,
    mineSection,
    mineTable,
    packsSection,
    packsTable,
    planCard,
    promptCard,
    shopHeading,
    shopNote,
    shopSection,
    shopTable,
    stepsCard,
    stepsNote,
    stepsTable,
};
