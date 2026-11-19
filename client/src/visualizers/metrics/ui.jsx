import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function EChart({ option, height }) {
    const elRef = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        const chart = echarts.init(elRef.current);
        chartRef.current = chart;
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(elRef.current);
        return () => {
            observer.disconnect();
            chart.dispose();
        };
    }, []);

    useEffect(() => {
        chartRef.current?.setOption(option, true);
    }, [option]);

    return <div ref={elRef} style={{ width: '100%', height }} />;
}

export function Card({ title, hint, right, wide, children }) {
    return (
        <div className={`metrics-card${wide ? ' wide' : ''}`}>
            <div className="metrics-card-head">
                <div>
                    <div className="metrics-card-title">{title}</div>
                    {hint && <div className="metrics-hint">{hint}</div>}
                </div>
                {right}
            </div>
            {children}
        </div>
    );
}

export function Kpis({ items }) {
    return (
        <div className="metrics-kpis">
            {items.map((k) => (
                <div className={`metrics-kpi tone-${k.tone}`} key={k.label} title={k.hint || k.label}>
                    <span>{k.label}</span>
                    <b>
                        {k.value}
                        {k.unit && <small>{k.unit}</small>}
                    </b>
                    {k.hint && <em>{k.hint}</em>}
                </div>
            ))}
        </div>
    );
}
