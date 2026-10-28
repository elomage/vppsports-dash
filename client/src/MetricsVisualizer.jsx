import React, { useEffect, useMemo, useState } from 'react';
import { fetchRunSensors, fetchSensorRaw } from './api';
import { EChart, Card, Kpis } from './metrics/ui';
import SegmentsTab from './metrics/SegmentsTab';
import { baseGrid, dashed, axisText } from './metrics/chartTheme';
import {
    G, fmt, kpi, sortedCopy, percentile, mean, std, rms, cv,
    sliceMax, sliceMin, absMax, medianDt, smooth, decimate, nearestIdx,
} from './metrics/stats';

const SIDE_COLOR = { '+': '#5470c6', '−': '#ee6666' };

const SECTOR_METRICS = {
    lat: 'Lateral load (P95 |ay|, g)',
    long: 'Longitudinal accel (mean ax, g)',
    jerk: 'Jerk RMS (g/s)',
    vib: 'Vibration (high-pass RMS, g)',
    peak: 'Peak g-force (g)',
    active: 'Time in load events (%)',
    steer: 'Steering activity (reversals/s)',
};

const TABS = [
    ['overview', 'Overview'],
    ['events', 'Events'],
    ['sectors', 'Sectors'],
    ['segments', 'Segments'],
    ['smooth', 'Smoothness'],
    ['steer', 'Steering'],
];








const corr = (a, b) => {
    const ma = mean(a);
    const mb = mean(b);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
};





const rollingRms = (arr, w) => {
    const pre = new Float64Array(arr.length + 1);
    for (let i = 0; i < arr.length; i++) pre[i + 1] = pre[i] + arr[i] * arr[i];
    const half = w >> 1;
    return Float64Array.from(arr, (_, i) => {
        const a = Math.max(0, i - half);
        const b = Math.min(arr.length, i + half + 1);
        return Math.sqrt((pre[b] - pre[a]) / (b - a));
    });
};





const steerReversals = (vals, threshold) => {
    let last = 0;
    let flips = 0;
    for (const v of vals) {
        if (Math.abs(v) < threshold) continue;
        const s = Math.sign(v);
        if (last && s !== last) flips++;
        last = s;
    }
    return flips;
};

const steerSplit = (gz, gyroT, t, inEvent, thr, gdt) => {
    let last = 0;
    let fIn = 0;
    let fOut = 0;
    let tIn = 0;
    let tOut = 0;
    for (let i = 0; i < gz.length; i++) {
        const inside = inEvent[nearestIdx(t, gyroT[i])] === 1;
        if (inside) tIn += gdt;
        else tOut += gdt;
        if (Math.abs(gz[i]) < thr) continue;
        const s = Math.sign(gz[i]);
        if (last && s !== last) {
            if (inside) fIn++;
            else fOut++;
        }
        last = s;
    }
    return { rateIn: tIn ? fIn / tIn : NaN, rateOut: tOut ? fOut / tOut : NaN };
};

const makeHist = (values, bins) => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const width = (max - min) / bins || 1;
    const counts = new Array(bins).fill(0);
    values.forEach((v) => {
        counts[Math.min(bins - 1, Math.floor((v - min) / width))]++;
    });
    return counts.map((c, i) => [min + width * (i + 0.5), (c / values.length) * 100]);
};

function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = a + len / 2;
                const xr = re[b] * cr - im[b] * ci;
                const xi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
                const ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
    }
}

const welch = (x, fs) => {
    const n = x.length;
    let m = 256;
    while (m * 2 <= Math.min(2048, n)) m *= 2;
    if (n < m) return null;
    const hop = m >> 1;
    const win = Float64Array.from({ length: m }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (m - 1)));
    const accum = new Float64Array(m / 2);
    let count = 0;
    for (let s = 0; s + m <= n; s += hop) {
        let mu = 0;
        for (let i = 0; i < m; i++) mu += x[s + i];
        mu /= m;
        const re = new Float64Array(m);
        const im = new Float64Array(m);
        for (let i = 0; i < m; i++) re[i] = (x[s + i] - mu) * win[i];
        fft(re, im);
        for (let k = 0; k < m / 2; k++) accum[k] += (Math.hypot(re[k], im[k]) * 4) / m;
        count++;
    }
    const out = [];
    for (let k = 1; k < m / 2; k++) out.push([(k * fs) / m, accum[k] / count]);
    return out;
};

const toRows = (readings, trims) => {
    let rows = readings
        .filter((r) => Number.isFinite(r?.timestamp) && Array.isArray(r?.data) && r.data.length >= 3)
        .filter((r) => !trims.some((t) => r.timestamp >= t.startTimestamp && r.timestamp <= t.endTimestamp))
        .map((r) => [Number(r.timestamp), Number(r.data[0]), Number(r.data[1]), Number(r.data[2])])
        .filter((r) => r.every(Number.isFinite))
        .sort((a, b) => a[0] - b[0]);
    const dt = medianDt(rows);
    if (dt && dt >= 1) rows = rows.map((r) => [r[0] / 1000, r[1], r[2], r[3]]);
    return rows;
};

const sensorText = (s) => `${s?.sensorType || ''} ${s?.name || ''}`;
const pickSensor = (sensors, regex) => sensors.find((s) => regex.test(sensorText(s)));

const detectEvents = ({ t, gm, gmS, ay, jerk, dt, base, p95 }) => {
    const n = t.length;
    const inEvent = new Uint8Array(n);
    if (!dt || p95 - base < 0.05) return { events: [], inEvent, threshold: NaN };

    const threshold = base + 0.4 * (p95 - base);
    const gapMax = Math.round(0.2 / dt);
    const minLen = Math.round(0.3 / dt);

    const spans = [];
    let s = -1;
    for (let i = 0; i < n; i++) {
        if (gmS[i] > threshold) {
            if (s < 0) s = i;
        } else if (s >= 0) {
            spans.push([s, i - 1]);
            s = -1;
        }
    }
    if (s >= 0) spans.push([s, n - 1]);

    const merged = [];
    for (const sp of spans) {
        const last = merged[merged.length - 1];
        if (last && sp[0] - last[1] <= gapMax) last[1] = sp[1];
        else merged.push([sp[0], sp[1]]);
    }

    const events = merged
        .filter(([a, b]) => b - a + 1 >= minLen)
        .map(([a, b], k) => {
            for (let i = a; i <= b; i++) inEvent[i] = 1;
            const seg = gm.slice(a, b + 1);
            const ayMean = mean(ay.slice(a, b + 1));
            return {
                id: k + 1,
                start: t[a],
                end: t[b],
                dur: t[b] - t[a],
                peak: sliceMax(gm, a, b + 1),
                mean: mean(seg),
                peakLat: absMax(ay, a, b + 1),
                side: ayMean >= 0 ? '+' : '−',
                jerk: rms(jerk.slice(a, b + 1)),
            };
        });

    return { events, inEvent, threshold };
};

export function computeSectors(raw, count) {
    const { n, t, ax, ay, gm, jerk, vib, inEvent, gyroT, gz, steerThr } = raw;
    return Array.from({ length: count }, (_, k) => {
        const a = Math.floor((k * n) / count);
        const b = Math.max(a + 1, Math.floor(((k + 1) * n) / count));
        const tA = t[a];
        const tB = t[b - 1];
        let act = 0;
        for (let i = a; i < b; i++) act += inEvent[i];
        const item = {
            lat: percentile(sortedCopy(ay.slice(a, b).map(Math.abs)), 95),
            long: mean(ax.slice(a, b)),
            jerk: rms(jerk.slice(a, b)),
            vib: rms(vib.slice(a, b)),
            peak: sliceMax(gm, a, b),
            active: (act / (b - a)) * 100,
            steer: NaN,
            label: `${fmt(tA, 1)}s`,
        };
        if (gyroT.length) {
            const vals = gz.filter((_, i) => gyroT[i] >= tA && gyroT[i] <= tB);
            item.steer = steerReversals(vals, steerThr) / Math.max(tB - tA, 1e-6);
        }
        return item;
    });
}


export function computeRide(accRaw, gyroRaw) {
    if (!accRaw || accRaw.length < 50) return null;

    const medianMag = percentile(sortedCopy(accRaw.map((r) => Math.hypot(r[1], r[2], r[3]))), 50);
    const scale = medianMag > 3 ? 1 / G : 1;

    const n = accRaw.length;
    const t0 = accRaw[0][0];
    const t = accRaw.map((r) => r[0] - t0);
    const ax = accRaw.map((r) => r[1] * scale);
    const ay = accRaw.map((r) => r[2] * scale);
    const az = accRaw.map((r) => r[3] * scale);
    const gm = ax.map((_, i) => Math.hypot(ax[i], ay[i], az[i]));
    const dt = medianDt(accRaw);
    const fs = dt ? 1 / dt : null;
    const duration = t[n - 1];
    const rate = fs || 100;

    const gmS = smooth(gm, Math.max(3, Math.round(rate * 0.05)));
    const axS = smooth(ax, 5);
    const jerk = axS.map((v, i) => (i === 0 || !dt ? 0 : (v - axS[i - 1]) / dt));
    const gmTrend = smooth(gm, Math.max(3, Math.round(rate * 0.1)));
    const vib = gm.map((v, i) => v - gmTrend[i]);

    const absAy = ay.map(Math.abs);
    const gmSorted = sortedCopy(gm);
    const base = percentile(gmSorted, 50);
    const p95 = percentile(gmSorted, 95);

    const { events, inEvent, threshold } = detectEvents({ t, gm, gmS, ay, jerk, dt, base, p95 });
    const activeShare = (inEvent.reduce((a, b) => a + b, 0) / n) * 100;
    const above2 = (gm.filter((v) => v > 2).length / n) * 100;

    let impulse = 0;
    const cumulative = t.map((x, i) => {
        impulse += Math.max(0, gm[i] - base) * (dt || 0);
        return [x, impulse];
    });

    const w1 = Math.max(3, Math.round(rate));
    const jerkRoll = rollingRms(jerk, w1);
    const vibRoll = rollingRms(vib, w1);
    const edge = n > w1 * 3 ? w1 : 0;
    const jerkSmoothest = sliceMin(jerkRoll, edge, n - edge);
    const jerkRoughest = sliceMax(jerkRoll, edge, n - edge);

    const spectrum = fs ? welch(gm, fs) : null;
    const dom = spectrum ? spectrum.filter((p) => p[0] >= 3).reduce((b, p) => (p[1] > b[1] ? p : b), [NaN, -1]) : null;

    const startEnd = Math.max(10, Math.floor(n * 0.1));

    const peaks = events.map((e) => e.peak);
    const durs = events.map((e) => e.dur);
    const plusTime = events.filter((e) => e.side === '+').reduce((a, e) => a + e.dur, 0);
    const totalEventTime = durs.reduce((a, b) => a + b, 0);
    const topEvent = events.reduce((b, e) => (!b || e.peak > b.peak ? e : b), null);
    const longest = events.reduce((b, e) => (!b || e.dur > b.dur ? e : b), null);

    const gyro = gyroRaw && gyroRaw.length > 50 ? gyroRaw : null;
    const gyroT = gyro ? gyro.map((r) => r[0] - t0) : [];
    const gz = gyro ? gyro.map((r) => r[3]) : [];
    const absGz = gz.map(Math.abs);
    const steerThr = gyro ? 0.1 * percentile(sortedCopy(absGz), 95) : 0;

    let steer = null;
    if (gyro) {
        const gdt = medianDt(gyro) || dt || 0.01;
        const split = steerSplit(gz, gyroT, t, inEvent, steerThr, gdt);
        const step = Math.max(1, Math.ceil(gz.length / 4000));
        const pairs = [];
        for (let i = 0; i < gz.length; i += step) pairs.push([gz[i], ay[nearestIdx(t, gyroT[i])]]);
        steer = {
            total: steerReversals(gz, steerThr) / Math.max(gyroT[gyroT.length - 1], 1e-6),
            meanAbs: mean(absGz),
            peak: percentile(sortedCopy(absGz), 99),
            split,
            corr: corr(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
            pairs,
            hist: makeHist(gz, 30),
            timeline: decimate(gyroT.map((x, i) => [x, gz[i]]), 2500),
        };
    }

    const kpis = {
        overview: [
            kpi('Duration', fmt(duration), 's', 'blue'),
            kpi('Peak load', fmt(gmSorted[n - 1]), 'g', 'red'),
            kpi('Sustained load (P95)', fmt(p95), 'g', 'red'),
            kpi('Peak lateral (P99)', fmt(percentile(sortedCopy(absAy), 99)), 'g', 'purple'),
            kpi('Start push (peak ax)', fmt(absMax(ax, 0, startEnd)), 'g', 'green'),
            kpi('Peak decel', fmt(Math.abs(Math.min(0, sliceMin(axS, 0, n)))), 'g', 'amber'),
            kpi('Time above 2 g', fmt(above2, 1), '%', 'red'),
            kpi('Load impulse', fmt(impulse), 'g·s', 'red', 'Area of g-force above the resting level'),
            kpi('Load events', String(events.length), '', 'blue'),
            kpi('Time in events', fmt(activeShare, 0), '%', 'blue'),
            kpi('Smoothness (jerk RMS)', fmt(rms(jerk)), 'g/s', 'green'),
            kpi('Sample rate', fs ? fmt(fs, 0) : '–', 'Hz', 'gray'),
        ],
        events: [
            kpi('Events', String(events.length), '', 'blue'),
            kpi('Mean duration', fmt(mean(durs)), 's', 'blue'),
            kpi('Longest event', longest ? fmt(longest.dur) : '–', 's', 'blue', longest ? `Event #${longest.id}` : ''),
            kpi('Mean peak load', fmt(mean(peaks)), 'g', 'red'),
            kpi('Highest peak', topEvent ? fmt(topEvent.peak) : '–', 'g', 'red', topEvent ? `Event #${topEvent.id}` : ''),
            kpi('Peak consistency (CV)', fmt(cv(peaks), 1), '%', 'purple', 'Lower means more repeatable peaks'),
            kpi('Duration consistency (CV)', fmt(cv(durs), 1), '%', 'purple'),
            kpi('Time on ay+ side', fmt(totalEventTime ? (plusTime / totalEventTime) * 100 : NaN, 0), '%', 'amber'),
            kpi('Mean event jerk', fmt(mean(events.map((e) => e.jerk))), 'g/s', 'green'),
        ],
        smooth: [
            kpi('Jerk RMS', fmt(rms(jerk)), 'g/s', 'green'),
            kpi('Jerk P95', fmt(percentile(sortedCopy(jerk.map(Math.abs)), 95)), 'g/s', 'green'),
            kpi('Smoothest second', fmt(jerkSmoothest), 'g/s', 'green'),
            kpi('Roughest second', fmt(jerkRoughest), 'g/s', 'red'),
            kpi('Vibration RMS', fmt(rms(vib), 3), 'g', 'amber'),
            kpi('Dominant vibration', dom && dom[1] > 0 ? fmt(dom[0], 1) : '–', 'Hz', 'purple', 'Strongest frequency above 3 Hz'),
        ],
        steer: gyro
            ? [
                kpi('Reversals', fmt(steer.total), '/s', 'blue'),
                kpi('Reversals in events', fmt(steer.split.rateIn), '/s', 'red'),
                kpi('Reversals on straights', fmt(steer.split.rateOut), '/s', 'green'),
                kpi('Mean |gyro z|', fmt(steer.meanAbs), '', 'purple'),
                kpi('Peak rate (P99)', fmt(steer.peak), '', 'amber'),
                kpi('Steering–lateral corr.', fmt(steer.corr), '', 'gray', 'Correlation of gyro z and lateral g'),
            ]
            : [],
    };

    return {
        duration,
        hasGyro: !!gyro,
        kpis,
        events,
        threshold,
        base,
        timeline: {
            gm: decimate(t.map((x, i) => [x, gm[i]]), 2500),
            ay: decimate(t.map((x, i) => [x, ay[i]]), 2500),
        },
        gg: decimate(ax.map((x, i) => [x, ay[i]]), 3000),
        hist: makeHist(gm, 30),
        cumulative: decimate(cumulative, 1000),
        rolling: {
            jerk: decimate(t.map((x, i) => [x, jerkRoll[i]]), 800),
            vib: decimate(t.map((x, i) => [x, vibRoll[i]]), 800),
        },
        spectrum,
        steer,
        raw: {
            n, t, ax, ay, az, gm, jerk, vib, inEvent, gyroT, gz, steerThr,
            gyro: gyro ? { t: gyroT, x: gyro.map((r) => r[1]), y: gyro.map((r) => r[2]), z: gz } : null,
        },
    };
}

const timelineOption = (tl, events, threshold) => ({
    grid: baseGrid,
    legend: { top: 0, textStyle: axisText },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v, 3) },
    dataZoom: [{ type: 'inside' }],
    xAxis: { type: 'value', name: 's', splitLine: dashed },
    yAxis: { type: 'value', name: 'g', splitLine: dashed, scale: true },
    series: [
        {
            name: 'g-force',
            type: 'line',
            data: tl.gm,
            showSymbol: false,
            sampling: 'lttb',
            lineStyle: { width: 1.2 },
            color: '#5470c6',
            markArea: {
                silent: true,
                itemStyle: { color: 'rgba(238,102,102,0.10)' },
                data: events.map((e) => [{ xAxis: e.start }, { xAxis: e.end }]),
            },
            markLine: Number.isFinite(threshold)
                ? {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { color: '#94a3b8', type: 'dashed' },
                    label: { formatter: 'event threshold' },
                    data: [{ yAxis: threshold }],
                }
                : undefined,
        },
        { name: 'lateral (ay)', type: 'line', data: tl.ay, showSymbol: false, sampling: 'lttb', lineStyle: { width: 1 }, color: '#ee6666' },
    ],
});

const ggOption = (gg) => ({
    grid: baseGrid,
    tooltip: { trigger: 'item', formatter: (p) => `ax ${fmt(p.value[0], 3)} g<br/>ay ${fmt(p.value[1], 3)} g` },
    xAxis: { type: 'value', name: 'longitudinal ax (g)', nameLocation: 'middle', nameGap: 26, splitLine: dashed, scale: true },
    yAxis: { type: 'value', name: 'lateral ay (g)', splitLine: dashed, scale: true },
    series: [{ type: 'scatter', data: gg, symbolSize: 3, itemStyle: { color: 'rgba(84,112,198,0.35)' }, large: true }],
});

const histOption = (hist, xName, color = '#91cc75') => ({
    grid: baseGrid,
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${fmt(v, 2)} %` },
    xAxis: { type: 'category', data: hist.map((h) => fmt(h[0], 2)), name: xName, nameLocation: 'middle', nameGap: 26 },
    yAxis: { type: 'value', name: '% of samples', splitLine: dashed },
    series: [{ type: 'bar', data: hist.map((h) => h[1]), barCategoryGap: '8%', itemStyle: { color, borderRadius: [3, 3, 0, 0] } }],
});

const sectorOption = (slices, key) => {
    const values = slices.map((s) => s[key]);
    const avg = mean(values.filter(Number.isFinite));
    return {
        grid: baseGrid,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmt(v, 3) },
        xAxis: { type: 'category', data: slices.map((s) => s.label), name: 'ride time', nameLocation: 'middle', nameGap: 26 },
        yAxis: { type: 'value', splitLine: dashed },
        series: [
            {
                type: 'bar',
                data: values.map((v) => ({
                    value: Number.isFinite(v) ? v : null,
                    itemStyle: { color: Number.isFinite(v) && v > avg * 1.25 ? '#ee6666' : '#5470c6', borderRadius: [4, 4, 0, 0] },
                })),
                markLine: {
                    symbol: 'none',
                    lineStyle: { color: '#6b7280', type: 'dashed' },
                    label: { formatter: `avg ${fmt(avg, 3)}` },
                    data: [{ yAxis: avg }],
                },
            },
        ],
    };
};

const cumulativeOption = (data) => ({
    grid: baseGrid,
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${fmt(v, 2)} g·s` },
    xAxis: { type: 'value', name: 's', splitLine: dashed },
    yAxis: { type: 'value', name: 'g·s', splitLine: dashed },
    series: [{ type: 'line', data, showSymbol: false, lineStyle: { width: 1.5 }, areaStyle: { opacity: 0.15 }, color: '#ee6666' }],
});

const eventsOption = (events) => {
    const avg = mean(events.map((e) => e.peak));
    return {
        grid: baseGrid,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (p) => {
                const e = events[p[0].dataIndex];
                return `Event ${e.id} (ay${e.side})<br/>Peak ${fmt(e.peak)} g<br/>Mean ${fmt(e.mean)} g<br/>Duration ${fmt(e.dur)} s<br/>Start ${fmt(e.start, 1)} s`;
            },
        },
        xAxis: { type: 'category', data: events.map((e) => `#${e.id}`), name: 'event', nameLocation: 'middle', nameGap: 26 },
        yAxis: { type: 'value', name: 'peak g', splitLine: dashed },
        series: [
            {
                type: 'bar',
                data: events.map((e) => ({ value: e.peak, itemStyle: { color: SIDE_COLOR[e.side], borderRadius: [4, 4, 0, 0] } })),
                markLine: {
                    symbol: 'none',
                    lineStyle: { color: '#6b7280', type: 'dashed' },
                    label: { formatter: `avg ${fmt(avg)}` },
                    data: [{ yAxis: avg }],
                },
            },
        ],
    };
};

const sideOption = (events) => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: axisText },
    series: [
        {
            type: 'pie',
            radius: ['50%', '72%'],
            center: ['50%', '45%'],
            label: { formatter: '{b}\n{c}' },
            data: ['+', '−'].map((s) => ({
                name: `ay${s}`,
                value: events.filter((e) => e.side === s).length,
                itemStyle: { color: SIDE_COLOR[s] },
            })),
        },
    ],
});

const durPeakOption = (events) => ({
    grid: baseGrid,
    tooltip: { trigger: 'item', formatter: (p) => `Event ${p.data[2]}<br/>${fmt(p.data[0])} s · ${fmt(p.data[1])} g` },
    xAxis: { type: 'value', name: 'duration (s)', nameLocation: 'middle', nameGap: 26, splitLine: dashed, scale: true },
    yAxis: { type: 'value', name: 'peak g', splitLine: dashed, scale: true },
    series: ['+', '−'].map((s) => ({
        name: `ay${s}`,
        type: 'scatter',
        symbolSize: 12,
        itemStyle: { color: SIDE_COLOR[s] },
        data: events.filter((e) => e.side === s).map((e) => [e.dur, e.peak, e.id]),
    })),
    legend: { top: 0, textStyle: axisText },
});

const rollingOption = (r) => ({
    grid: { ...baseGrid, right: 40 },
    legend: { top: 0, textStyle: axisText },
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v, 3) },
    dataZoom: [{ type: 'inside' }],
    xAxis: { type: 'value', name: 's', splitLine: dashed },
    yAxis: [
        { type: 'value', name: 'jerk g/s', splitLine: dashed },
        { type: 'value', name: 'vib g', splitLine: { show: false } },
    ],
    series: [
        { name: 'jerk RMS (1 s)', type: 'line', data: r.jerk, showSymbol: false, lineStyle: { width: 1.3 }, color: '#91cc75' },
        { name: 'vibration RMS (1 s)', type: 'line', yAxisIndex: 1, data: r.vib, showSymbol: false, lineStyle: { width: 1.3 }, color: '#fac858' },
    ],
});

const spectrumOption = (spectrum) => ({
    grid: baseGrid,
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v, 4) },
    xAxis: { type: 'log', name: 'Hz', min: 0.5, splitLine: dashed },
    yAxis: { type: 'value', name: 'amplitude (g)', splitLine: dashed },
    dataZoom: [{ type: 'inside' }],
    series: [{ type: 'line', data: spectrum.filter((p) => p[0] >= 0.5), showSymbol: false, lineStyle: { width: 1 }, areaStyle: { opacity: 0.15 }, color: '#fac858' }],
});

const steeringOption = (data) => ({
    grid: baseGrid,
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v, 2) },
    dataZoom: [{ type: 'inside' }],
    xAxis: { type: 'value', name: 's', splitLine: dashed },
    yAxis: { type: 'value', name: 'gyro z', splitLine: dashed, scale: true },
    series: [{ type: 'line', data, showSymbol: false, sampling: 'lttb', lineStyle: { width: 1 }, color: '#73c0de' }],
});

const steerLatOption = (pairs) => ({
    grid: baseGrid,
    tooltip: { trigger: 'item', formatter: (p) => `gyro z ${fmt(p.value[0])}<br/>ay ${fmt(p.value[1], 3)} g` },
    xAxis: { type: 'value', name: 'gyro z', nameLocation: 'middle', nameGap: 26, splitLine: dashed, scale: true },
    yAxis: { type: 'value', name: 'lateral ay (g)', splitLine: dashed, scale: true },
    series: [{ type: 'scatter', data: pairs, symbolSize: 3, itemStyle: { color: 'rgba(115,192,222,0.4)' }, large: true }],
});

function EventsTable({ events }) {
    const maxPeak = Math.max(...events.map((e) => e.peak));
    return (
        <div className="metrics-table-wrap">
            <table className="metrics-table">
                <thead>
                <tr>
                    <th>#</th>
                    <th>Start</th>
                    <th>Duration</th>
                    <th>Peak g</th>
                    <th>Mean g</th>
                    <th>Peak lateral</th>
                    <th>Side</th>
                    <th>Jerk RMS</th>
                </tr>
                </thead>
                <tbody>
                {events.map((e) => (
                    <tr key={e.id}>
                        <td>{e.id}</td>
                        <td>{fmt(e.start, 1)} s</td>
                        <td>{fmt(e.dur)} s</td>
                        <td className={e.peak === maxPeak ? 'is-top' : ''}>{fmt(e.peak)}</td>
                        <td>{fmt(e.mean)}</td>
                        <td>{fmt(e.peakLat)}</td>
                        <td>
                            <span className="metrics-pill" style={{ background: SIDE_COLOR[e.side] }}>ay{e.side}</span>
                        </td>
                        <td>{fmt(e.jerk)}</td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}

export default function MetricsVisualizer({ selectedRun, removeFunction }) {
    const [state, setState] = useState({ data: null, status: 'loading', info: '' });
    const [tab, setTab] = useState('overview');
    const [sector, setSector] = useState('lat');
    const [sectorCount, setSectorCount] = useState(10);

    useEffect(() => {
        if (!selectedRun?._id) {
            setState({ data: null, status: 'empty', info: '' });
            return;
        }
        let cancelled = false;
        setState({ data: null, status: 'loading', info: '' });

        const load = async () => {
            const sensors = await fetchRunSensors(selectedRun._id);
            const accSensor = pickSensor(sensors, /acc/i);
            const gyroSensor = pickSensor(sensors, /gyr/i);

            if (!accSensor) {
                const names = sensors.map((s) => sensorText(s).trim() || s.sensorId).join(', ');
                return { data: null, status: 'nosignal', info: names };
            }

            const trims = Array.isArray(selectedRun.trims) ? selectedRun.trims : [];
            const [accReadings, gyroReadings] = await Promise.all([
                fetchSensorRaw(selectedRun._id, accSensor.sensorId),
                gyroSensor ? fetchSensorRaw(selectedRun._id, gyroSensor.sensorId) : Promise.resolve([]),
            ]);

            const result = computeRide(toRows(accReadings, trims), toRows(gyroReadings, trims));
            return { data: result, status: result ? 'ready' : 'empty', info: '' };
        };

        load()
            .then((next) => {
                if (!cancelled) setState(next);
            })
            .catch((e) => {
                if (!cancelled) setState({ data: null, status: 'error', info: String(e?.message || e) });
            });

        return () => {
            cancelled = true;
        };
    }, [selectedRun?._id, selectedRun?.trims]);

    const { data, status, info } = state;

    const sectorKeys = useMemo(
        () => Object.keys(SECTOR_METRICS).filter((k) => k !== 'steer' || data?.hasGyro),
        [data]
    );
    const activeSector = sectorKeys.includes(sector) ? sector : 'lat';

    const slices = useMemo(() => (data ? computeSectors(data.raw, sectorCount) : []), [data, sectorCount]);

    const options = useMemo(() => {
        if (!data) return null;
        return {
            timeline: timelineOption(data.timeline, data.events, data.threshold),
            gg: ggOption(data.gg),
            hist: histOption(data.hist, 'g-force'),
            sector: sectorOption(slices, activeSector),
            cumulative: cumulativeOption(data.cumulative),
            events: data.events.length ? eventsOption(data.events) : null,
            side: data.events.length ? sideOption(data.events) : null,
            durPeak: data.events.length ? durPeakOption(data.events) : null,
            rolling: rollingOption(data.rolling),
            spectrum: data.spectrum ? spectrumOption(data.spectrum) : null,
            steering: data.steer ? steeringOption(data.steer.timeline) : null,
            steerLat: data.steer ? steerLatOption(data.steer.pairs) : null,
            steerHist: data.steer ? histOption(data.steer.hist, 'gyro z', '#73c0de') : null,
        };
    }, [data, slices, activeSector]);

    const tabs = TABS.filter(([key]) => key !== 'steer' || data?.hasGyro);
    const activeTab = tabs.some(([key]) => key === tab) ? tab : 'overview';

    return (
        <div className="metrics-panel">
            <div className="metrics-header">
                <div>
                    <div className="metrics-title">Ride metrics</div>
                    {data && (
                        <div className="metrics-sub">
                            {fmt(data.duration)} s · {data.events.length} load events
                            {Number.isFinite(data.threshold) && ` · threshold ${fmt(data.threshold)} g`}
                        </div>
                    )}
                </div>
                <button className="metrics-close" onClick={removeFunction} aria-label="Remove metrics">✕</button>
            </div>

            {status === 'loading' && <div className="metrics-state">Loading ride metrics…</div>}
            {status === 'error' && <div className="metrics-state">Failed to load sensor data: {info}</div>}
            {status === 'empty' && <div className="metrics-state">Not enough accelerometer data for this run.</div>}
            {status === 'nosignal' && (
                <div className="metrics-state">No accelerometer sensor found. Sensors on this run: {info || 'none'}</div>
            )}

            {status === 'ready' && options && (
                <>
                    <div className="metrics-tabs">
                        {tabs.map(([key, label]) => (
                            <button key={key} className={`metrics-tab${activeTab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'overview' && (
                        <>
                            <Kpis items={data.kpis.overview} />
                            <div className="metrics-charts">
                                <Card wide title="Load over the ride" hint="g-force and lateral g against ride time. Shaded areas are detected load events. Scroll to zoom.">
                                    <EChart option={options.timeline} height={300} />
                                </Card>
                                <Card title="g-g diagram" hint="Longitudinal vs lateral g. A tight cluster means a smooth line.">
                                    <EChart option={options.gg} height={280} />
                                </Card>
                                <Card title="Load distribution" hint="Share of the ride spent at each g-force level.">
                                    <EChart option={options.hist} height={280} />
                                </Card>
                            </div>
                        </>
                    )}

                    {activeTab === 'events' && (
                        <>
                            <Kpis items={data.kpis.events} />
                            {data.events.length === 0 ? (
                                <div className="metrics-state">No load events detected in this ride.</div>
                            ) : (
                                <div className="metrics-charts">
                                    <Card wide title="Peak load per event" hint="Each bar is one load event. Colour shows the side of the lateral load (ay+ or ay−).">
                                        <EChart option={options.events} height={280} />
                                    </Card>
                                    <Card title="Side balance" hint="Number of events on each lateral side.">
                                        <EChart option={options.side} height={260} />
                                    </Card>
                                    <Card title="Duration vs peak load" hint="Long events with low peaks suggest a wide line. Short high peaks suggest a hard hit.">
                                        <EChart option={options.durPeak} height={260} />
                                    </Card>
                                    <Card wide title="Event details" hint="Highest peak is highlighted.">
                                        <EventsTable events={data.events} />
                                    </Card>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'sectors' && (
                        <div className="metrics-charts">
                            <Card
                                wide
                                title="Ride sectors"
                                hint="The ride split into equal time slices. Red bars are 25% above the average."
                                right={
                                    <div className="metrics-controls">
                                        <select value={sectorCount} onChange={(e) => setSectorCount(Number(e.target.value))}>
                                            {[5, 10, 20].map((c) => (
                                                <option key={c} value={c}>{c} slices</option>
                                            ))}
                                        </select>
                                        <select value={activeSector} onChange={(e) => setSector(e.target.value)}>
                                            {sectorKeys.map((k) => (
                                                <option key={k} value={k}>{SECTOR_METRICS[k]}</option>
                                            ))}
                                        </select>
                                    </div>
                                }
                            >
                                <EChart option={options.sector} height={300} />
                            </Card>
                            <Card wide title="Cumulative load" hint="Running total of g-force above the resting level. Steep parts are where the ride loads the body most.">
                                <EChart option={options.cumulative} height={260} />
                            </Card>
                        </div>
                    )}

                    {activeTab === 'smooth' && (
                        <>
                            <Kpis items={data.kpis.smooth} />
                            <div className="metrics-charts">
                                <Card wide title="Rolling smoothness" hint="Jerk and vibration over a 1 s window. Peaks show rough sections.">
                                    <EChart option={options.rolling} height={280} />
                                </Card>
                                {options.spectrum && (
                                    <Card wide title="Vibration spectrum" hint="Frequency content of g-force averaged over the whole ride. Peaks show runner or track chatter.">
                                        <EChart option={options.spectrum} height={280} />
                                    </Card>
                                )}
                            </div>
                        </>
                    )}

                    {activeTab === 'steer' && data.steer && (
                        <>
                            <Kpis items={data.kpis.steer} />
                            <div className="metrics-charts">
                                <Card wide title="Steering (gyro z)" hint="Rotation rate around the vertical axis. Frequent reversals mean a wobbly line.">
                                    <EChart option={options.steering} height={280} />
                                </Card>
                                <Card title="Steering vs lateral load" hint="Gyro z against lateral g. A clean diagonal means steering input matches the load.">
                                    <EChart option={options.steerLat} height={280} />
                                </Card>
                                <Card title="Steering rate distribution" hint="How much of the ride is spent at each rotation rate.">
                                    <EChart option={options.steerHist} height={280} />
                                </Card>
                            </div>
                        </>
                    )}

                    {activeTab === 'segments' && <SegmentsTab raw={data.raw} hasGyro={data.hasGyro} />}
                </>
            )}
        </div>
    );
}