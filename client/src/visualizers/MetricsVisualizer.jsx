import React, { useEffect, useMemo, useState } from 'react';
import { fetchRunSensors, fetchSensorRaw } from "../api";
import { EChart, Card, Kpis } from './metrics/ui';
import SegmentsTab from './metrics/SegmentsTab';
import { baseGrid, dashed, axisText } from './metrics/chartTheme';
import {
    G, fmt, kpi, sortedCopy, percentile, mean, rms,
    sliceMax, sliceMin, absMax, medianDt, smooth, decimate, nearestIdx,
} from './metrics/stats';

const TABS = [
    ['overview', 'Overview'],
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

const detectLoadMask = ({ n, gmS, dt, base, p95 }) => {
    const inEvent = new Uint8Array(n);
    if (!dt || p95 - base < 0.05) return inEvent;

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

    merged
        .filter(([a, b]) => b - a + 1 >= minLen)
        .forEach(([a, b]) => {
            for (let i = a; i <= b; i++) inEvent[i] = 1;
        });

    return inEvent;
};

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

    const inEvent = detectLoadMask({ n, gmS, dt, base, p95 });
    const above2 = (gm.filter((v) => v > 2).length / n) * 100;

    let impulse = 0;
    for (let i = 0; i < n; i++) impulse += Math.max(0, gm[i] - base) * (dt || 0);

    const w1 = Math.max(3, Math.round(rate));
    const jerkRoll = rollingRms(jerk, w1);
    const vibRoll = rollingRms(vib, w1);
    const edge = n > w1 * 3 ? w1 : 0;
    const jerkSmoothest = sliceMin(jerkRoll, edge, n - edge);
    const jerkRoughest = sliceMax(jerkRoll, edge, n - edge);

    const spectrum = fs ? welch(gm, fs) : null;
    const dom = spectrum ? spectrum.filter((p) => p[0] >= 3).reduce((b, p) => (p[1] > b[1] ? p : b), [NaN, -1]) : null;

    const startEnd = Math.max(10, Math.floor(n * 0.1));

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
            kpi('Sample rate', fs ? fmt(fs, 0) : '–', 'Hz', 'gray'),
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
        timeline: {
            gm: decimate(t.map((x, i) => [x, gm[i]]), 2500),
            ay: decimate(t.map((x, i) => [x, ay[i]]), 2500),
        },
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

const timelineOption = (tl) => ({
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
        },
        { name: 'lateral (ay)', type: 'line', data: tl.ay, showSymbol: false, sampling: 'lttb', lineStyle: { width: 1 }, color: '#ee6666' },
    ],
});

const histOption = (hist, xName, color = '#91cc75') => ({
    grid: baseGrid,
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${fmt(v, 2)} %` },
    xAxis: { type: 'category', data: hist.map((h) => fmt(h[0], 2)), name: xName, nameLocation: 'middle', nameGap: 26 },
    yAxis: { type: 'value', name: '% of samples', splitLine: dashed },
    series: [{ type: 'bar', data: hist.map((h) => h[1]), barCategoryGap: '8%', itemStyle: { color, borderRadius: [3, 3, 0, 0] } }],
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

export default function MetricsVisualizer({ selectedRun, removeFunction }) {
    const [state, setState] = useState({ data: null, status: 'loading', info: '' });
    const [tab, setTab] = useState('overview');

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

    const options = useMemo(() => {
        if (!data) return null;
        return {
            timeline: timelineOption(data.timeline),
            rolling: rollingOption(data.rolling),
            spectrum: data.spectrum ? spectrumOption(data.spectrum) : null,
            steering: data.steer ? steeringOption(data.steer.timeline) : null,
            steerLat: data.steer ? steerLatOption(data.steer.pairs) : null,
            steerHist: data.steer ? histOption(data.steer.hist, 'gyro z', '#73c0de') : null,
        };
    }, [data]);

    const tabs = TABS.filter(([key]) => key !== 'steer' || data?.hasGyro);
    const activeTab = tabs.some(([key]) => key === tab) ? tab : 'overview';

    return (
        <div className="metrics-panel">
            <div className="metrics-header">
                <div>
                    <div className="metrics-title">Ride metrics</div>
                    {data && <div className="metrics-sub">{fmt(data.duration)} s</div>}
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
                                <Card wide title="Load over the ride" hint="g-force and lateral g against ride time. Scroll to zoom.">
                                    <EChart option={options.timeline} height={300} />
                                </Card>
                            </div>
                        </>
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