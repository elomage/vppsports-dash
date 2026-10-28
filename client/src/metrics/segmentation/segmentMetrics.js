import { absMax, cv, fmt, kpi, lowerBound, mean, medianStep, percentile, rms, sliceMax, sortedCopy, upperBound } from '../stats';
import { isCurveKind } from './segmentRide';

const PHASES = { entry: [0, 0.3], apex: [0.3, 0.7], exit: [0.7, 1] };

const phaseRange = (len, [lo, hi]) => {
    const a = Math.floor(lo * len);
    const b = Math.min(Math.max(Math.ceil(hi * len), a + 2), len);
    return [a, b];
};

const jerkRms = (arr, dt) => {
    const d = [];
    for (let i = 1; i < arr.length; i++) d.push((arr[i] - arr[i - 1]) / dt);
    return rms(d);
};

const zeroCrossRate = (arr, dt) => {
    let flips = 0;
    let last = 0;
    for (const v of arr) {
        const s = Math.sign(v);
        if (!s) continue;
        if (last && s !== last) flips++;
        last = s;
    }
    return flips / Math.max(arr.length * dt, 1e-9);
};

const trapz = (arr, dx) => {
    let sum = 0;
    for (let i = 1; i < arr.length; i++) sum += ((arr[i] + arr[i - 1]) / 2) * dx;
    return sum;
};

const finite = (arr) => arr.filter(Number.isFinite);

export function computeSegmentMetrics(seg, raw) {
    const { t, ax, ay, az } = raw;
    const gyro = seg.gyroUsed ? raw.gyro : null;
    const n = t.length;
    const rows = [];

    seg.segments.forEach((s, i) => {
        const a = s.startIdx;
        const b = Math.min(s.endIdx + 1, n);
        if (b - a < 2) return;

        const isCurve = isCurveKind(s.kind);
        const sign = isCurve && s.kind === 'curve_r' ? -1 : 1;
        const dt = medianStep(t.slice(a, b)) || 0.01;

        const sx = ax.slice(a, b);
        const sy = ay.slice(a, b).map((v) => v * sign);
        const sz = az.slice(a, b);
        const gTot = sx.map((_, k) => Math.hypot(sx[k], sy[k], sz[k]));

        const row = {
            id: i,
            kind: s.kind,
            label: s.label,
            isCurve,
            tStart: s.tStart,
            tEnd: s.tEnd,
            duration: s.tEnd - s.tStart,
            azMax: sliceMax(sz, 0, sz.length),
            azMean: mean(sz),
            ayAbsP95: percentile(sortedCopy(sy.map(Math.abs)), 95),
            ayInward: isCurve ? mean(sy.map((v) => (v > 0 ? 1 : 0))) * 100 : NaN,
            axMean: mean(sx),
            jerkAx: jerkRms(sx, dt),
            jerkAy: jerkRms(sy, dt),
            jerkAz: jerkRms(sz, dt),
            gMax: sliceMax(gTot, 0, gTot.length),
            gzPeak: NaN,
            gzClean: NaN,
            gzFlips: NaN,
            entry: NaN,
            apex: NaN,
            exit: NaN,
        };

        if (gyro) {
            const gi = lowerBound(gyro.t, s.tStart);
            const ge = upperBound(gyro.t, s.tEnd);
            if (ge - gi >= 2) {
                const gz = gyro.z.slice(gi, ge).map((v) => v * sign);
                const gdt = medianStep(gyro.t.slice(gi, ge)) || dt;
                const signedInt = trapz(gz, gdt);
                const absInt = trapz(gz.map(Math.abs), gdt);
                row.gzPeak = absMax(gz, 0, gz.length);
                row.gzClean = Math.abs(signedInt) / Math.max(absInt, 1e-9);
                row.gzFlips = zeroCrossRate(gz, gdt);
            }
        }

        if (isCurve && sz.length >= 9) {
            for (const [name, range] of Object.entries(PHASES)) {
                const [pa, pb] = phaseRange(sz.length, range);
                row[name] = mean(sz.slice(pa, pb));
            }
        }

        rows.push(row);
    });

    const curves = rows.filter((r) => r.isCurve);
    const straights = rows.filter((r) => r.kind === 'straight');
    const total = rows.reduce((sum, r) => sum + r.duration, 0);
    const curveTime = curves.reduce((sum, r) => sum + r.duration, 0);
    const rights = curves.filter((r) => r.kind === 'curve_r').length;
    const strongest = curves.reduce((best, r) => (!best || r.azMax > best.azMax ? r : best), null);
    const peaks = curves.map((r) => r.azMax);
    const durs = curves.map((r) => r.duration);

    const kpis = [
        kpi('Curves', String(curves.length), '', 'blue', `${rights} right · ${curves.length - rights} left`),
        kpi('Straights', String(straights.length), '', 'green'),
        kpi('Swing phase ends', fmt(seg.tSwingEnd), 's', 'gray', 'End of the start push'),
        kpi('Time in curves', fmt(total ? (curveTime / total) * 100 : NaN, 0), '%', 'blue'),
        kpi('Mean curve duration', fmt(mean(durs)), 's', 'blue'),
        kpi('Mean straight duration', fmt(mean(straights.map((r) => r.duration))), 's', 'green'),
        kpi('Mean curve peak az', fmt(mean(peaks)), 'g', 'red'),
        kpi('Strongest curve', strongest ? fmt(strongest.azMax) : '–', 'g', 'red', strongest ? strongest.label : ''),
        kpi('Peak consistency (CV)', fmt(cv(peaks), 1), '%', 'purple', 'Lower means more repeatable curves'),
        kpi('Duration consistency (CV)', fmt(cv(durs), 1), '%', 'purple'),
        kpi('Mean curve jerk (az)', fmt(mean(curves.map((r) => r.jerkAz))), 'g/s', 'green'),
        ...(seg.gyroUsed ? [kpi('Mean gyro z clean ratio', fmt(mean(finite(curves.map((r) => r.gzClean)))), '', 'amber', '1.0 means one clean rotation direction')] : []),
        kpi('Detection sensitivity', fmt(seg.sensitivity), '', 'gray', seg.expectedCurves != null && !seg.converged ? `Could not match ${seg.expectedCurves} curves` : ''),
    ];

    return { rows, curves, straights, kpis };
}
