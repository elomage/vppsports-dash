import React, { useMemo, useState } from 'react';
import { Card, EChart, Kpis } from './ui';
import { fmt } from './stats';
import { segmentRide } from './segmentation/segmentRide';
import { computeSegmentMetrics } from './segmentation/segmentMetrics';
import { CURVE_METRICS, GYRO_METRICS, KIND_COLOR, curveMetricOption, phaseOption, segTimelineOption, shareOption } from './segmentation/segmentCharts';

function SegmentsTable({ rows, gyro }) {
    return (
        <div className="metrics-table-wrap">
            <table className="metrics-table">
                <thead>
                <tr>
                    <th>Segment</th>
                    <th>Start</th>
                    <th>Duration</th>
                    <th>Peak az</th>
                    <th>Mean az</th>
                    <th>Lateral P95</th>
                    <th>Jerk az</th>
                    {gyro && <th>Gyro z peak</th>}
                    {gyro && <th>Clean ratio</th>}
                </tr>
                </thead>
                <tbody>
                {rows.map((r) => (
                    <tr key={r.id}>
                        <td>
                            <span className="metrics-pill" style={{ background: KIND_COLOR[r.kind] }}>{r.label}</span>
                        </td>
                        <td>{fmt(r.tStart, 1)} s</td>
                        <td>{fmt(r.duration)} s</td>
                        <td>{fmt(r.azMax)}</td>
                        <td>{fmt(r.azMean)}</td>
                        <td>{fmt(r.ayAbsP95)}</td>
                        <td>{fmt(r.jerkAz)}</td>
                        {gyro && <td>{fmt(r.gzPeak)}</td>}
                        {gyro && <td>{fmt(r.gzClean)}</td>}
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}

export default function SegmentsTab({ raw, hasGyro }) {
    const [useGyro, setUseGyro] = useState(hasGyro);
    const [expected, setExpected] = useState('');
    const [metric, setMetric] = useState('azMax');

    const seg = useMemo(
        () => segmentRide(raw, { useGyro: useGyro && hasGyro, expectedCurves: expected === '' ? null : Number(expected) }),
        [raw, useGyro, hasGyro, expected]
    );
    const metrics = useMemo(() => (seg ? computeSegmentMetrics(seg, raw) : null), [seg, raw]);

    const metricKeys = Object.keys(CURVE_METRICS).filter((k) => seg?.gyroUsed || !GYRO_METRICS.includes(k));
    const activeMetric = metricKeys.includes(metric) ? metric : 'azMax';

    const options = useMemo(() => {
        if (!seg || !metrics) return null;
        const hasCurves = metrics.curves.length > 0;
        return {
            timeline: segTimelineOption(seg),
            metric: hasCurves ? curveMetricOption(metrics.curves, activeMetric) : null,
            phase: hasCurves && metrics.curves.some((c) => Number.isFinite(c.entry)) ? phaseOption(metrics.curves) : null,
            share: shareOption(metrics.rows),
        };
    }, [seg, metrics, activeMetric]);

    if (!seg || !metrics) return <div className="metrics-state">Not enough data to segment this ride.</div>;

    const controls = (
        <div className="metrics-controls">
            {hasGyro && (
                <label className="metrics-check">
                    <input type="checkbox" checked={useGyro} onChange={(e) => setUseGyro(e.target.checked)} />
                    Use gyro
                </label>
            )}
            <input
                type="number"
                min="0"
                placeholder="auto curves"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                title="Expected number of curves. Leave empty for automatic detection."
            />
        </div>
    );

    return (
        <>
            <Kpis items={metrics.kpis} />
            <div className="metrics-charts">
                <Card
                    wide
                    title="Segmented ride"
                    hint="Smoothed az with detected segments: blue is a right curve, red a left curve, green a straight. Set the curve count to force the detector to match the track."
                    right={controls}
                >
                    <EChart option={options.timeline} height={300} />
                </Card>

                {options.metric && (
                    <Card
                        wide
                        title="Per-curve comparison"
                        hint="One bar per curve in ride order."
                        right={
                            <div className="metrics-controls">
                                <select value={activeMetric} onChange={(e) => setMetric(e.target.value)}>
                                    {metricKeys.map((k) => (
                                        <option key={k} value={k}>{CURVE_METRICS[k]}</option>
                                    ))}
                                </select>
                            </div>
                        }
                    >
                        <EChart option={options.metric} height={280} />
                    </Card>
                )}

                {options.phase && (
                    <Card title="Entry / apex / exit load" hint="Mean az in the first 30%, middle 40% and last 30% of each curve.">
                        <EChart option={options.phase} height={280} />
                    </Card>
                )}

                <Card title="Time share" hint="How the ride time splits between segment types.">
                    <EChart option={options.share} height={280} />
                </Card>

                <Card wide title="Segment details">
                    <SegmentsTable rows={metrics.rows} gyro={seg.gyroUsed} />
                </Card>
            </div>
        </>
    );
}
