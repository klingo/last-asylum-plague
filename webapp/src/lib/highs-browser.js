/**
 * Browser loader for the HiGHS solver: Vite emits highs.wasm as an asset and this points the
 * loader at it. Only pages that actually solve something import this (lazy-loaded solver).
 */
import wasmUrl from 'highs/runtime?url';
import { loadHighs } from './lp.js';

function loadBrowserHighs() {
    return loadHighs({ locateFile: () => wasmUrl });
}

export { loadBrowserHighs };
