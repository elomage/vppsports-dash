import { absMax, percentile, sortedCopy } from '../stats';

export function detectSwingEnd(
    ax,
    t,
    { maxTime = 7, threshold = 0.18, neighborWindow = 3, neighborSoftRatio = 0.5, endRatio = 0.2, tailRatio = 0.05, noiseMultiplier = 2 } = {}
) {
    if (t.length < 2 || ax.length < 2) return 0;

    let n = 0;
    while (n < t.length && t[n] <= maxTime) n++;
    if (n < 10) return ax.length - 1;

    const win = Array.from(ax.slice(0, n));
    const med = percentile(sortedCopy(win), 50);
    const sig = win.map((v) => v - med);
    const s = sig.map((v) => (v < 0 ? -1 : 1));

    const zc = [];
    for (let i = 0; i < n - 1; i++) if (s[i + 1] !== s[i]) zc.push(i);
    if (zc.length < 3) return n - 1;

    const starts = zc.slice(0, -1);
    const ends = zc.slice(1);
    const amps = starts.map((st, i) => absMax(sig, st, ends[i] + 1));

    const strictReal = amps.map((a) => a > threshold);
    const softReal = amps.map((a) => a > threshold * neighborSoftRatio);

    let lastReal = -1;
    for (let i = strictReal.length - 1; i >= 0; i--) {
        if (!strictReal[i]) continue;
        const lo = Math.max(0, i - neighborWindow);
        const hi = Math.min(strictReal.length, i + neighborWindow + 1);
        let soft = 0;
        for (let k = lo; k < hi; k++) if (softReal[k]) soft++;
        if (soft > 1) {
            lastReal = i;
            break;
        }
    }

    if (lastReal < 0) {
        for (let i = strictReal.length - 1; i >= 0; i--) {
            if (strictReal[i]) {
                lastReal = i;
                break;
            }
        }
    }
    if (lastReal < 0) return 0;

    const lastStart = starts[lastReal];
    const lastEnd = ends[lastReal];
    let peakIdx = lastStart;
    for (let j = lastStart; j <= lastEnd; j++) if (Math.abs(sig[j]) > Math.abs(sig[peakIdx])) peakIdx = j;
    const peakValue = Math.abs(sig[peakIdx]);

    const settle = peakValue * endRatio;
    let cutoff = lastEnd;
    for (let j = peakIdx; j <= lastEnd; j++) {
        if (Math.abs(sig[j]) < settle) {
            cutoff = j;
            break;
        }
    }

    const globalPeak = absMax(sig, 0, n);
    const tailStart = Math.floor(0.85 * n);
    const noise = tailStart < n ? percentile(sortedCopy(sig.slice(tailStart).map(Math.abs)), 50) : 0;
    const tailFloor = Math.max(globalPeak * tailRatio, noise * noiseMultiplier);

    const w = Math.max(5, Math.floor(n / 40));
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + Math.abs(sig[i]);
    const h = (w - 1) >> 1;
    const smoothed = (j) => {
        const a = Math.max(0, j + h - w + 1);
        const b = Math.min(n - 1, j + h);
        return b < a ? 0 : (pre[b + 1] - pre[a]) / w;
    };

    const quietNeeded = Math.max(w * 2, Math.floor(n / 25));
    let extended = cutoff;
    let quiet = 0;
    for (let j = cutoff + 1; j < n; j++) {
        if (smoothed(j) > tailFloor) {
            extended = j;
            quiet = 0;
        } else {
            quiet++;
            if (quiet >= quietNeeded) break;
        }
    }
    return extended;
}
