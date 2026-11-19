import { useEffect, useRef } from "react";
import * as echarts from "echarts";

const TEXT = "#64748b";
const GRID = "rgba(128,128,128,0.2)";

const buildMarkers = (markers) => ({
    markLine: {
        silent: true,
        symbol: "none",
        data: [
            {
                xAxis: markers.start,
                lineStyle: { color: "#16a34a", type: "dashed", width: 1.2 },
                label: { show: true, position: "insideEndTop", formatter: `start ${markers.start.toFixed(1)}s`, color: "#16a34a" },
            },
            {
                xAxis: markers.end,
                lineStyle: { color: "#dc2626", type: "dashed", width: 1.2 },
                label: { show: true, position: "insideEndTop", formatter: `end ${markers.end.toFixed(1)}s`, color: "#dc2626" },
            },
        ],
    },
    markArea: {
        silent: true,
        itemStyle: { color: "rgba(37,99,235,0.07)" },
        data: [[{ xAxis: markers.start }, { xAxis: markers.end }]],
    },
});

const RidePlot = ({ title, series, height = 260 }) => {
    const elRef = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        const chart = echarts.init(elRef.current, null, { renderer: "canvas" });
        chartRef.current = chart;
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(elRef.current);
        return () => {
            observer.disconnect();
            chart.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.setOption(
            {
                animation: false,
                title: { text: title, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: TEXT } },
                legend: { show: series.length > 1, right: 8, top: 0, textStyle: { color: TEXT, fontSize: 11 } },
                grid: { left: 56, right: 16, top: 34, bottom: 38 },
                tooltip: { trigger: "axis", axisPointer: { type: "line" } },
                xAxis: {
                    type: "value",
                    scale: true,
                    name: "time (s)",
                    nameLocation: "middle",
                    nameGap: 24,
                    nameTextStyle: { color: TEXT },
                    axisLabel: { color: TEXT },
                    splitLine: { lineStyle: { color: GRID } },
                },
                yAxis: {
                    type: "value",
                    scale: true,
                    axisLabel: { color: TEXT },
                    splitLine: { lineStyle: { color: GRID } },
                },
                dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }],
                series: series.map((item) => ({
                    name: item.name,
                    type: "line",
                    showSymbol: false,
                    sampling: "lttb",
                    animation: false,
                    lineStyle: { width: item.width ?? 1.2, color: item.color, opacity: item.opacity ?? 1 },
                    itemStyle: { color: item.color },
                    data: item.data,
                    ...(item.markers ? buildMarkers(item.markers) : {}),
                })),
            },
            { replaceMerge: ["series"] },
        );
    }, [title, series]);

    return <div ref={elRef} className="rp-plot" style={{ height }} />;
};

export default RidePlot;