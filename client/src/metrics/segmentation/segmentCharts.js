import { axisText, baseGrid, dashed } from '../chartTheme';
import { decimate, fmt, mean } from '../stats';

export const KIND_COLOR = { start: '#94a3b8', straight: '#91cc75', curve_r: '#5470c6', curve_l: '#ee6666' };

const BAND = {
    start: 'rgba(148,163,184,0.18)',
    straight: 'rgba(145,204,117,0.12)',
    curve_r: 'rgba(84,112,198,0.22)',
    curve_l: 'rgba(238,102,102,0.22)',
};

export const CURVE_METRICS = {
    azMax: 'Peak az (g)',
    azMean: 'Mean az (g)',
    ayAbsP95: 'Lateral P95 |ay| (g)',
    duration: 'Duration (s)',
    jerkAz: 'Jerk RMS az (g/s)',
    gMax: 'Peak total g',
    gzPeak: 'Peak |gyro z|',
    gzClean: 'Gyro z clean ratio',
    gzFlips: 'Gyro z flips/s',
};

export const GYRO_METRICS = ['gzPeak', 'gzClean', 'gzFlips'];

export const segTimelineOption = (seg) => ({
    grid: baseGrid,
    tooltip: { trigger: 'axis', valueFormatter: (v) => fmt(v, 3) },
    dataZoom: [{ type: 'inside' }],
    xAxis: { type: 'value', name: 's', splitLine: dashed },
    yAxis: { type: 'value', name: 'az (g, smoothed)', splitLine: dashed, scale: true },
    series: [
        {
            type: 'line',
            showSymbol: false,
            sampling: 'lttb',
            lineStyle: { width: 1.2 },
            color: '#334155',
            data: decimate(Array.from(seg.t, (x, i) => [x, seg.azSmooth[i]]), 2500),
            markArea: {
                silent: true,
                label: { show: true, position: 'insideTop', fontSize: 10, color: '#475569' },
                data: seg.segments.map((s) => [
                    { name: s.kind === 'straight' || s.kind === 'start' ? '' : s.label, xAxis: s.tStart, itemStyle: { color: BAND[s.kind] } },
                    { xAxis: s.tEnd },
                ]),
            },
            markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#94a3b8', type: 'dashed' },
                data: [
                    { yAxis: seg.threshold, label: { formatter: 'curve threshold' } },
                    { xAxis: seg.tSwingEnd, label: { formatter: 'swing end' } },
                ],
            },
        },
    ],
});

export const curveMetricOption = (curves, key) => {
    const avg = mean(curves.map((c) => c[key]).filter(Number.isFinite));
    return {
        grid: baseGrid,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmt(v, 3) },
        xAxis: { type: 'category', data: curves.map((c) => c.label), name: 'curve', nameLocation: 'middle', nameGap: 26 },
        yAxis: { type: 'value', splitLine: dashed },
        series: [
            {
                type: 'bar',
                data: curves.map((c) => ({
                    value: Number.isFinite(c[key]) ? c[key] : null,
                    itemStyle: { color: KIND_COLOR[c.kind], borderRadius: [4, 4, 0, 0] },
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

export const phaseOption = (curves) => {
    const withPhases = curves.filter((c) => Number.isFinite(c.entry));
    return {
        grid: baseGrid,
        legend: { top: 0, textStyle: axisText },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => fmt(v, 3) },
        xAxis: { type: 'category', data: withPhases.map((c) => c.label) },
        yAxis: { type: 'value', name: 'mean az (g)', splitLine: dashed },
        series: [
            ['entry', '#73c0de'],
            ['apex', '#ee6666'],
            ['exit', '#91cc75'],
        ].map(([name, color]) => ({
            name,
            type: 'bar',
            data: withPhases.map((c) => c[name]),
            itemStyle: { color, borderRadius: [3, 3, 0, 0] },
        })),
    };
};

export const shareOption = (rows) => {
    const groups = [
        ['Start', 'start'],
        ['Straights', 'straight'],
        ['Right curves', 'curve_r'],
        ['Left curves', 'curve_l'],
    ];
    return {
        tooltip: { trigger: 'item', formatter: '{b}: {c} s ({d}%)' },
        legend: { bottom: 0, textStyle: axisText },
        series: [
            {
                type: 'pie',
                radius: ['50%', '72%'],
                center: ['50%', '45%'],
                label: { formatter: '{b}\n{d}%' },
                data: groups
                    .map(([name, kind]) => ({
                        name,
                        value: Number(rows.filter((r) => r.kind === kind).reduce((a, r) => a + r.duration, 0).toFixed(2)),
                        itemStyle: { color: KIND_COLOR[kind] },
                    }))
                    .filter((d) => d.value > 0),
            },
        ],
    };
};
