import { detectSwingEnd } from './detectSwingEnd';
import { detectCurveIntervals } from './curveIntervals';
import { lowerBound, medianStep, smooth } from '../stats';

const interp = (xs, xp, fp) =>
    xs.map((v) => {
        if (v <= xp[0]) return fp[0];
        if (v >= xp[xp.length - 1]) return fp[fp.length - 1];
        const i = lowerBound(xp, v);
        if (xp[i] === v) return fp[i];
        return fp[i - 1] + ((fp[i] - fp[i - 1]) * (v - xp[i - 1])) / (xp[i] - xp[i - 1]);
    });

const kindLabel = (kind, index) => {
    if (kind === 'start') return 'Start';
    if (kind === 'curve_r') return `Right ${index}`;
    if (kind === 'curve_l') return `Left ${index}`;
    return `Straight ${index}`;
};

export const isCurveKind = (kind) => kind === 'curve_r' || kind === 'curve_l';

const makeSegment = (kind, index, startIdx, endIdx, t) => ({
    kind,
    index,
    label: kindLabel(kind, index),
    startIdx,
    endIdx,
    tStart: t[startIdx],
    tEnd: t[endIdx],
});

export function segmentRide(raw, { useGyro = true, expectedCurves = null, smoothS = 0.4, minCurveS = 0.4, minGyroDeg = 20, minStraightS = 0.25 } = {}) {
    const { t, ax, ay, az } = raw;
    const n = t.length;
    if (n < 50) return null;

    const gyro = useGyro ? raw.gyro : null;
    const gyroUsed = !!gyro;
    const fs = 1 / Math.max(medianStep(t) || 0, 1e-9);

    const swingEnd = detectSwingEnd(ax, t);
    const win = Math.max(3, Math.floor(smoothS * fs));
    const azSmooth = smooth(az, win);
    const aySmooth = smooth(ay, win);
    const azPos = azSmooth.map((v) => Math.max(v, 0));

    let gMag = null;
    if (gyroUsed) {
        const magRaw = gyro.t.map((_, i) => Math.hypot(gyro.x[i], gyro.y[i], gyro.z[i]));
        gMag = smooth(interp(t, gyro.t, magRaw), Math.max(win, Math.floor(0.4 * fs)));
    }

    const run = (sens) => detectCurveIntervals(azPos, gMag, swingEnd, fs, gyroUsed, minCurveS, minStraightS, minGyroDeg, sens);

    let result;
    let sensitivity = 1;
    let converged = true;

    if (expectedCurves == null) {
        result = run(1);
    } else {
        let best = null;
        let bestScore = null;
        for (let i = 0; i < 19; i++) {
            const sens = 0.7 + 0.05 * i;
            const r = run(sens);
            const diff = Math.abs(r.intervals.length - expectedCurves);
            const score = [diff, Math.abs(sens - 1)];
            if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
                best = { r, sens };
                bestScore = score;
            }
            if (diff === 0 && Math.abs(sens - 1) < 0.05) break;
        }
        result = best.r;
        sensitivity = best.sens;
        converged = bestScore[0] === 0;
    }

    const curveKind = (si, ei) => {
        if (gyroUsed) {
            const gi = lowerBound(gyro.t, t[si]);
            const ge = lowerBound(gyro.t, t[ei]);
            if (ge > gi) {
                let sum = 0;
                for (let i = gi; i < ge; i++) sum += gyro.z[i];
                return sum / (ge - gi) < 0 ? 'curve_r' : 'curve_l';
            }
        }
        let sum = 0;
        for (let i = si; i <= ei; i++) sum += aySmooth[i];
        return sum / (ei - si + 1) < 0 ? 'curve_r' : 'curve_l';
    };

    const segments = [makeSegment('start', 1, 0, Math.min(swingEnd, n - 1), t)];
    segments[0].tEnd = t[Math.min(swingEnd, n - 1)];

    let cIdx = 1;
    let sIdx = 1;
    let prevEnd = swingEnd;

    for (const [s, e] of result.intervals) {
        if (e <= swingEnd) continue;
        const si = Math.max(s, swingEnd);
        const ei = Math.min(e, n - 1);
        if (ei <= si) continue;
        if (si > prevEnd) segments.push(makeSegment('straight', sIdx++, prevEnd, si, t));
        segments.push(makeSegment(curveKind(si, ei), cIdx++, si, ei, t));
        prevEnd = ei;
    }

    if (n - 1 > prevEnd) segments.push(makeSegment('straight', sIdx, prevEnd, n - 1, t));

    return {
        segments,
        swingEnd,
        tSwingEnd: t[Math.min(swingEnd, n - 1)],
        t,
        azSmooth,
        threshold: result.info.azThresh,
        gyroUsed,
        converged,
        sensitivity,
        expectedCurves,
    };
}
