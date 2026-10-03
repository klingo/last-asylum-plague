/**
 * The full-page loading overlay (`#loading-overlay`) around a recalculation. The recalculations
 * (weekly plan, acquisition plans) run synchronously, so the overlay is first given a chance to
 * paint; otherwise the page would just freeze without feedback. Overlapping calls keep it visible
 * until the last one finishes.
 */
let active = 0;

function overlay() {
    return document.getElementById('loading-overlay');
}

/**
 * Waits until the browser has painted the current DOM (next frame + a task). Background tabs get
 * no animation frames, so a short timeout takes over there instead of waiting forever.
 */
function nextPaint() {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                setTimeout(resolve, 0);
            }
        };
        requestAnimationFrame(finish);
        setTimeout(finish, 50);
    });
}

/** Runs `work` (sync or async) with the loading overlay shown; returns its result. */
async function withLoading(work) {
    active++;
    overlay().hidden = false;
    try {
        await nextPaint();
        return await work();
    } finally {
        active--;
        if (active === 0) {
            overlay().hidden = true;
        }
    }
}

export { withLoading };
