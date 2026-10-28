export const G = 9.80665;

export const fmt = (v, d = 2) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d)) : '–');

export const kpi = (label, value, unit, tone, hint) => ({ label, value, unit, tone, hint });

export const sortedCopy = (arr) => Float64Array.from(arr).sort();

export const percentile = (sorted, p) => {
    if (!sorted.length) return NaN;
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);

export const std = (arr) => {
    const m = mean(arr);
    return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
};

export const rms = (arr) => Math.sqrt(mean(arr.map((v) => v * v)));

export const cv = (arr) => (arr.length > 1 ? (std(arr) / mean(arr)) * 100 : NaN);

export const sliceMax = (arr, a, b) => {
    let m = -Infinity;
    for (let i = a; i < b; i++) if (arr[i] > m) m = arr[i];
    return m;
};

export const sliceMin = (arr, a, b) => {
    let m = Infinity;
    for (let i = a; i < b; i++) if (arr[i] < m) m = arr[i];
    return m;
};

export const absMax = (arr, a, b) => {
    let m = 0;
    for (let i = a; i < b; i++) if (Math.abs(arr[i]) > m) m = Math.abs(arr[i]);
    return m;
};

const medianOf = (diffs) => {
    if (!diffs.length) return null;
    diffs.sort((a, b) => a - b);
    const m = diffs.length >> 1;
    return diffs.length % 2 ? diffs[m] : (diffs[m - 1] + diffs[m]) / 2;
};

export const medianDt = (rows) => {
    const diffs = [];
    for (let i = 1; i < rows.length; i++) {
        const d = rows[i][0] - rows[i - 1][0];
        if (d > 0) diffs.push(d);
    }
    return medianOf(diffs);
};

export const medianStep = (t) => {
    const diffs = [];
    for (let i = 1; i < t.length; i++) {
        const d = t[i] - t[i - 1];
        if (d > 0) diffs.push(d);
    }
    return medianOf(diffs);
};

export const smooth = (arr, w) => {
    const prefix = new Float64Array(arr.length + 1);
    for (let i = 0; i < arr.length; i++) prefix[i + 1] = prefix[i] + arr[i];
    const half = w >> 1;
    return arr.map((_, i) => {
        const a = Math.max(0, i - half);
        const b = Math.min(arr.length, i + half + 1);
        return (prefix[b] - prefix[a]) / (b - a);
    });
};

export const decimate = (arr, max) => {
    const step = Math.max(1, Math.ceil(arr.length / max));
    return step === 1 ? arr : arr.filter((_, i) => i % step === 0);
};

export const lowerBound = (t, x) => {
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t[mid] < x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};

export const upperBound = (t, x) => {
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t[mid] <= x) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};

export const nearestIdx = (t, x) => {
    const lo = Math.min(lowerBound(t, x), t.length - 1);
    if (lo > 0 && Math.abs(t[lo - 1] - x) < Math.abs(t[lo] - x)) return lo - 1;
    return lo;
};
