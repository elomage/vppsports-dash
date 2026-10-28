import { findPeaks } from './findPeaks';
import { percentile, sliceMax, sliceMin, sortedCopy } from '../stats';

const runsInMask = (mask, searchStart) => {
    const intervals = [];
    const n = mask.length;
    let i = searchStart;
    while (i < n) {
        if (!mask[i]) {
            i++;
            continue;
        }
        let j = i;
        while (j < n && mask[j]) j++;
        intervals.push([i, j - 1]);
        i = j + 1;
    }
    return intervals;
};

const refineBoundaries = (intervals, azPos, azQuiet, azThresh, swingEnd, fs, minGap, adj) => {
    if (!intervals.length) return intervals;
    const n = azPos.length;
    const boundary = azQuiet + 0.35 * (azThresh - azQuiet);
    const maxWalk = Math.max(1, Math.floor(0.4 * fs));
    const refined = [];

    intervals.forEach(([s, e], k) => {
        const prevEnd = refined.length ? refined[refined.length - 1][1] : swingEnd - 1;
        const gapLeft = adj[k] ? 0 : minGap;
        const prevFloor = prevEnd + 1 + gapLeft;
        let newS = s;
        const walkLimit = Math.max(prevFloor, s - maxWalk);
        while (newS > walkLimit && azPos[newS - 1] > boundary) newS--;

        const gapRight = k + 1 < adj.length && adj[k + 1] ? 0 : minGap;
        const nextStart = k + 1 < intervals.length ? intervals[k + 1][0] : n;
        const nextCeiling = nextStart - 1 - gapRight;
        let newE = e;
        const walkLimitE = Math.min(nextCeiling, e + maxWalk);
        while (newE < walkLimitE && azPos[newE + 1] > boundary) newE++;

        refined.push(newS > newE ? [s, e] : [newS, newE]);
    });
    return refined;
};

const bridgeRuns = (intervals, azPos, azQuiet, azThresh, shortGap, longGap, dipRatio) => {
    if (intervals.length < 2) return intervals.slice();
    const bridged = [intervals[0]];

    for (let k = 1; k < intervals.length; k++) {
        const [s, e] = intervals[k];
        const [ps, pe] = bridged[bridged.length - 1];
        const gap = s - pe - 1;
        let doBridge = false;

        if (gap > 0 && gap <= shortGap) {
            const prevPeak = sliceMax(azPos, ps, pe + 1);
            const currPeak = sliceMax(azPos, s, e + 1);
            const localPeak = Math.min(prevPeak, currPeak);
            const dipMin = sliceMin(azPos, pe, s + 1);
            doBridge = (localPeak > 0 ? dipMin / localPeak : 0) >= dipRatio;
        } else if (gap > shortGap && gap <= longGap) {
            const softFloor = azQuiet + (azThresh - azQuiet) * 0.3;
            let active = 0;
            for (let i = pe; i <= s; i++) if (azPos[i] > softFloor) active++;
            doBridge = active / (s - pe + 1) >= 0.7;
        }

        if (doBridge) bridged[bridged.length - 1] = [ps, e];
        else bridged.push([s, e]);
    }
    return bridged;
};

const splitAtValleys = (intervals, azPos, azThresh, azQuiet, minSamples, gMag) => {
    const out = [];
    const adj = [];

    for (const [s, e] of intervals) {
        const seg = azPos.slice(s, e + 1);
        if (seg.length < 2 * minSamples) {
            out.push([s, e]);
            adj.push(false);
            continue;
        }

        const peakFloor = azQuiet + 0.2 * (azThresh - azQuiet);
        const prominence = Math.max(0.1, 0.3 * (azThresh - azQuiet));
        const peaks = findPeaks(seg, { prominence, height: peakFloor, distance: Math.max(2, minSamples >> 1) });

        if (peaks.length < 2) {
            out.push([s, e]);
            adj.push(false);
            continue;
        }

        const gy = gMag ? gMag.slice(s, e + 1) : null;
        const splitPoints = [];

        for (let k = 0; k < peaks.length - 1; k++) {
            const a = peaks[k];
            const b = peaks[k + 1];
            let valleyIdx = a;
            for (let i = a; i <= b; i++) if (seg[i] < seg[valleyIdx]) valleyIdx = i;
            const valleyV = seg[valleyIdx];
            const peakV = Math.min(seg[a], seg[b]);
            const depth = peakV > 0 ? valleyV / peakV : 1;

            const condA = depth <= 0.5 && valleyV < azThresh;
            const condD = depth <= 0.7 && valleyV < azThresh * 1.25;
            const bothStrong = seg[a] > azThresh * 1.5 && seg[b] > azThresh * 1.5;
            const condE = depth <= 0.55 && bothStrong;
            const condF = valleyV < azQuiet + 0.3 * (azThresh - azQuiet);
            const maxPeak = Math.max(seg[a], seg[b]);
            const similarity = maxPeak > 0 ? peakV / maxPeak : 0;
            const condG = similarity >= 0.6 && depth <= 0.75 && maxPeak >= azThresh;

            let condB = false;
            let condC = false;
            if (gy) {
                const gyPeakLocal = Math.min(
                    sliceMax(gy, Math.max(0, a - minSamples), a + 1),
                    sliceMax(gy, b, Math.min(gy.length, b + minSamples) + 1)
                );
                const gyValleyMin = sliceMin(gy, a, b + 1);
                const gyDipOk = gyPeakLocal > 0 && gyValleyMin / gyPeakLocal <= 0.55;
                condB = depth <= 0.65 && gyDipOk;
                condC = depth <= 0.75 && gyDipOk && valleyV < azThresh * 1.5;
            }

            if (condA || condB || condC || condD || condE || condF || condG) splitPoints.push(valleyIdx);
        }

        if (!splitPoints.length) {
            out.push([s, e]);
            adj.push(false);
            continue;
        }

        const subs = [];
        let prevEndOff = -1;
        for (const vi of splitPoints) {
            const subStart = prevEndOff + 1;
            if (vi - subStart + 1 >= minSamples) subs.push([s + subStart, s + vi]);
            prevEndOff = vi - 1;
        }
        const lastStart = prevEndOff + 1;
        if (seg.length - 1 - lastStart + 1 >= minSamples) subs.push([s + lastStart, s + seg.length - 1]);

        if (subs.length >= 2) {
            subs.forEach((sub, k) => {
                out.push(sub);
                adj.push(k > 0);
            });
        } else {
            out.push([s, e]);
            adj.push(false);
        }
    }
    return { intervals: out, adj };
};

export function detectCurveIntervals(azPos, gMag, swingEnd, fs, gyroUsed, minCurveS, minStraightS, minGyroDeg, sensitivity) {
    const n = azPos.length;
    const azPost = n > swingEnd ? azPos.slice(swingEnd) : azPos;
    const azQuiet = azPost.length ? percentile(sortedCopy(azPost), 25) : 0;

    const baseThresh = Math.max(azQuiet + 0.12, 0.18);
    const azThresh = Math.max(azQuiet + 0.05, baseThresh * sensitivity);
    const baseMinPeak = gyroUsed ? Math.max(azQuiet + 0.3, 0.4) : Math.max(azQuiet + 0.15, 0.22);
    const azMinPeak = Math.max(azQuiet + 0.08, baseMinPeak * sensitivity);
    const azMinEver = Math.max(azQuiet + 0.05, 0.1);

    let gyMinPeak = 0;
    if (gyroUsed && gMag) {
        const gyQuiet = percentile(sortedCopy(gMag.slice(swingEnd)), 25);
        gyMinPeak = Math.max(gyQuiet * 1.5, gyQuiet + 20, minGyroDeg * 1.5) * sensitivity;
    }

    const minSamples = Math.max(2, Math.floor(minCurveS * fs * 0.5));
    const bridgeSamples = Math.max(1, Math.floor(0.6 * fs));
    const straightMinSamples = Math.max(1, Math.floor(minStraightS * fs));

    const active = new Uint8Array(n);
    for (let i = swingEnd; i < n; i++) active[i] = azPos[i] > azThresh ? 1 : 0;

    const raw = runsInMask(active, swingEnd);
    const bridged = bridgeRuns(raw, azPos, azQuiet, azThresh, bridgeSamples, Math.max(bridgeSamples, Math.floor(1.5 * fs)), 0.2);
    const { intervals: split, adj } = splitAtValleys(bridged, azPos, azThresh, azQuiet, minSamples, gMag);

    const filtered = [];
    const filteredAdj = [];
    split.forEach(([s, e], k) => {
        const azPeak = sliceMax(azPos, s, e + 1);
        const gyPeak = gMag ? sliceMax(gMag, s, e + 1) : 0;
        const tooShort = e - s + 1 < minSamples;
        const noAz = azPeak < azMinEver;
        const strong = azPeak >= azMinPeak;
        const borderline = !!gMag && azPeak >= azMinEver && gyPeak >= gyMinPeak;
        if (tooShort || noAz || !(strong || borderline)) return;
        filtered.push([s, e]);
        filteredAdj.push(adj[k]);
    });

    const intervals = refineBoundaries(filtered, azPos, azQuiet, azThresh, swingEnd, fs, straightMinSamples, filteredAdj);
    return { intervals, info: { azQuiet, azThresh, azMinPeak, gyMinPeak } };
}
