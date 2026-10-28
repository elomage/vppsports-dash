import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Visualizationselection.css';
import { checkRunVideoExists, fetchPluginAssignments } from './api';

const componentsMap = {
    info: React.lazy(() => import('./Infovisualizer')),
    echart: React.lazy(() => import('./EChartGraph')),
    video: React.lazy(() => import('./VideoVisualizer')),
    model: React.lazy(() => import('./Modelvisualizer')),
    metrics: React.lazy(() => import('./MetricsVisualizer')),
};

const TOOLBAR = [
    { type: 'echart', label: 'Graph' },
    { type: 'video', label: 'Video' },
    { type: 'info', label: 'Info' },
    { type: 'model', label: 'Model' },
    { type: 'metrics', label: 'Ride metrics' },
];

const WRAPPER_CLASS = {
    echart: 'graph-wrapper',
    model: 'model-wrapper',
    video: 'video-wrapper',
    metrics: 'metrics-wrapper',
};

const CHARTS_PER_ROW = 2;

function buildDisplayItems(components) {
    const videoComp = components.find((c) => c.type === 'video');
    const modelComp = components.find((c) => c.type === 'model');
    if (!videoComp || !modelComp) return components;

    return components.reduce((acc, comp) => {
        if (comp.type === 'model') return acc;
        if (comp.type === 'video') {
            acc.push({ type: 'group', id: '__video-model-group__', flexGrow: comp.flexGrow, video: comp, model: modelComp });
        } else {
            acc.push(comp);
        }
        return acc;
    }, []);
}

function buildRows(items) {
    const charts = items.filter((i) => i.type === 'echart');
    if (charts.length <= CHARTS_PER_ROW) return items.length ? [items] : [];

    const others = items.filter((i) => i.type !== 'echart');
    const rows = [];
    for (let i = 0; i < charts.length; i += CHARTS_PER_ROW) {
        rows.push(charts.slice(i, i + CHARTS_PER_ROW));
    }
    if (others.length) rows.push(others);
    return rows;
}

function isTypeEnabled(vizPlugins, type) {
    if (!vizPlugins) return true;
    const plugin = vizPlugins.find((p) => p.id === type);
    return plugin ? plugin.enabled : type === 'metrics';
}

const newId = () => Date.now() + Math.random();

export default function ComponentSelector({ selectedRun, effectiveTimestamps, sliderValue, setSliderValue, onEffectiveTimestampsChange }) {
    const [selectedComponent, setSelectedComponent] = useState([
        { id: 1, type: 'echart', flexGrow: 1 },
        { id: 2, type: 'video', flexGrow: 1 },
        { id: 3, type: 'metrics', flexGrow: 1 },
    ]);
    const [hasVideoForRun, setHasVideoForRun] = useState(true);
    const [vizPlugins, setVizPlugins] = useState(null);
    const [enabledFilterIds, setEnabledFilterIds] = useState(null);

    const addComponent = (type) => {
        setSelectedComponent((prev) => {
            if (type === 'metrics' && prev.some((c) => c.type === 'metrics')) return prev;
            return [...prev, { id: newId(), type, flexGrow: 1 }];
        });
    };

    const removeComponent = (id) => {
        setSelectedComponent((prev) => prev.filter((c) => c.id !== id));
    };

    const updateFlexGrow = useCallback((id, flexGrow) => {
        setSelectedComponent((prev) =>
            prev.map((c) => (c.id === id ? { ...c, flexGrow: Math.max(0.1, flexGrow) } : c))
        );
    }, []);

    useEffect(() => {
        let isCancelled = false;

        const dropVideo = () => {
            setHasVideoForRun(false);
            setSelectedComponent((prev) => prev.filter((c) => c.type !== 'video'));
        };

        const update = async () => {
            if (!selectedRun?._id) {
                if (!isCancelled) dropVideo();
                return;
            }
            try {
                const hasVideo = await checkRunVideoExists(selectedRun._id);
                if (isCancelled) return;
                setHasVideoForRun(hasVideo);
                if (!hasVideo) {
                    setSelectedComponent((prev) => prev.filter((c) => c.type !== 'video'));
                } else {
                    setSelectedComponent((prev) =>
                        prev.some((c) => c.type === 'video')
                            ? prev
                            : [...prev, { id: newId(), type: 'video', flexGrow: 1 }]
                    );
                }
            } catch {
                if (!isCancelled) dropVideo();
            }
        };

        update();
        return () => {
            isCancelled = true;
        };
    }, [selectedRun?._id]);

    useEffect(() => {
        const contextId = selectedRun?.contextId ? String(selectedRun.contextId) : null;

        if (!contextId) {
            setVizPlugins(null);
            setEnabledFilterIds(null);
            return;
        }

        let isCancelled = false;

        fetchPluginAssignments(contextId, 'visualization')
            .then((data) => {
                if (isCancelled) return;
                const plugins = Array.isArray(data?.plugins) ? data.plugins : null;
                setVizPlugins(plugins);
                if (plugins) {
                    const disabled = new Set(plugins.filter((p) => !p.enabled).map((p) => p.id));
                    if (disabled.size > 0) {
                        setSelectedComponent((prev) => prev.filter((c) => !disabled.has(c.type)));
                    }
                }
            })
            .catch(() => {
                if (!isCancelled) setVizPlugins(null);
            });

        fetchPluginAssignments(contextId, 'filter')
            .then((data) => {
                if (isCancelled) return;
                const plugins = Array.isArray(data?.plugins) ? data.plugins : null;
                setEnabledFilterIds(plugins ? plugins.filter((p) => p.enabled).map((p) => p.id) : null);
            })
            .catch(() => {
                if (!isCancelled) setEnabledFilterIds(null);
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedRun?.contextId]);

    const visible = selectedComponent.filter((c) => c.type !== 'video' || hasVideoForRun);
    const metricsItem = visible.find((c) => c.type === 'metrics');
    const displayItems = buildDisplayItems(visible.filter((c) => c.type !== 'metrics'));
    const charts = displayItems.filter((i) => i.type === 'echart');
    const rows = buildRows(displayItems);

    const applyResize = (item, grow) => {
        if (item.type === 'group') {
            updateFlexGrow(item.video.id, grow);
            updateFlexGrow(item.model.id, grow);
        } else {
            updateFlexGrow(item.id, grow);
        }
    };

    const suspense = (node) => <React.Suspense fallback={<div className="viz-loading">Loading…</div>}>{node}</React.Suspense>;

    const renderHandle = (row, item, index) =>
        index < row.length - 1 && (
            <ResizeHandle
                leftComponent={item}
                rightComponent={row[index + 1]}
                onResize={(l, r) => {
                    applyResize(item, l);
                    applyResize(row[index + 1], r);
                }}
            />
        );

    const renderItem = (row) => (item, index) => {
        if (item.type === 'group') {
            const VideoComponent = componentsMap.video;
            const ModelComponent = componentsMap.model;
            return (
                <React.Fragment key={item.id}>
                    <div className="video-model-group viz-card" style={{ flex: `${item.flexGrow} 1 0`, minWidth: 300 }}>
                        <div className="video-wrapper" style={{ flex: 1, minHeight: 200 }}>
                            {suspense(
                                <VideoComponent
                                    selectedRun={selectedRun}
                                    sliderValue={sliderValue}
                                    removeFunction={() => removeComponent(item.video.id)}
                                    style={{ width: '100%', height: '100%', flex: 1 }}
                                    setSliderValue={setSliderValue}
                                    effectiveTimestamps={effectiveTimestamps}
                                />
                            )}
                        </div>
                        <div className="model-wrapper" style={{ flex: 1, minHeight: 200 }}>
                            {suspense(
                                <ModelComponent
                                    selectedRun={selectedRun}
                                    sliderValue={sliderValue}
                                    removeFunction={() => removeComponent(item.model.id)}
                                    style={{ width: '100%', height: '100%', flex: 1 }}
                                    setSliderValue={setSliderValue}
                                    effectiveTimestamps={effectiveTimestamps}
                                />
                            )}
                        </div>
                    </div>
                    {renderHandle(row, item, index)}
                </React.Fragment>
            );
        }

        const chartIndex = item.type === 'echart' ? charts.indexOf(item) : undefined;
        const Component = componentsMap[item.type];

        return (
            <React.Fragment key={item.id}>
                <div
                    className={`${WRAPPER_CLASS[item.type] || 'component-wrapper'} viz-card`}
                    style={{ flex: `${item.flexGrow} 1 0`, minWidth: 200, minHeight: 200, position: 'relative', display: 'flex', flexDirection: 'column' }}
                >
                    {suspense(
                        <Component
                            selectedRun={selectedRun}
                            sliderValue={sliderValue}
                            removeFunction={() => removeComponent(item.id)}
                            style={{ width: '100%', height: '100%', flex: 1 }}
                            setSliderValue={setSliderValue}
                            onEffectiveTimestampsChange={item.type === 'echart' ? onEffectiveTimestampsChange : undefined}
                            enabledFilterIds={item.type === 'echart' ? enabledFilterIds : undefined}
                            effectiveTimestamps={item.type === 'video' || item.type === 'model' ? effectiveTimestamps : undefined}
                            chartIndex={chartIndex}
                        />
                    )}
                </div>
                {renderHandle(row, item, index)}
            </React.Fragment>
        );
    };

    const MetricsComponent = componentsMap.metrics;

    return (
        <>
            <div className="viz-toolbar">
                <span className="viz-toolbar-label">Add view</span>
                {TOOLBAR.filter(({ type }) => isTypeEnabled(vizPlugins, type) && (type !== 'video' || hasVideoForRun)).map(({ type, label }) => (
                    <button
                        key={type}
                        type="button"
                        className="viz-add-btn"
                        disabled={type === 'metrics' && !!metricsItem}
                        onClick={() => addComponent(type)}
                    >
                        <span className="viz-add-plus">+</span>
                        {label}
                    </button>
                ))}
            </div>
            <div className="viz-stage" id="visualization-component-wrapper">
                {rows.map((row, i) => (
                    <div className="viz-row" key={i}>
                        {row.map(renderItem(row))}
                    </div>
                ))}
                {metricsItem && (
                    <div className="viz-card viz-metrics-panel">
                        {suspense(
                            <MetricsComponent
                                selectedRun={selectedRun}
                                removeFunction={() => removeComponent(metricsItem.id)}
                            />
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

function ResizeHandle({ leftComponent, rightComponent, onResize }) {
    const [isDragging, setIsDragging] = useState(false);
    const startRef = useRef({ x: 0, leftGrow: 0, rightGrow: 0, totalGrow: 0 });
    const handleRef = useRef(null);
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;

    const handleMouseDown = (e) => {
        e.preventDefault();
        startRef.current = {
            x: e.clientX,
            leftGrow: leftComponent.flexGrow,
            rightGrow: rightComponent.flexGrow,
            totalGrow: leftComponent.flexGrow + rightComponent.flexGrow,
        };
        setIsDragging(true);
    };

    const handleDoubleClick = () => {
        const total = leftComponent.flexGrow + rightComponent.flexGrow;
        onResizeRef.current(total / 2, total / 2);
    };

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e) => {
            const container = handleRef.current?.parentElement;
            if (!container) return;

            const { x, leftGrow, rightGrow, totalGrow } = startRef.current;
            const ratio = (e.clientX - x) / container.offsetWidth;

            let l = Math.max(0.1, leftGrow + ratio * totalGrow);
            let r = Math.max(0.1, rightGrow - ratio * totalGrow);
            const sum = l + r;
            onResizeRef.current((l / sum) * totalGrow, (r / sum) * totalGrow);
        };

        const handleMouseUp = () => setIsDragging(false);

        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    return (
        <div
            ref={handleRef}
            className={`resize-handle${isDragging ? ' dragging' : ''}`}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            title="Drag to resize, double-click to reset"
        >
            <div className="resize-grip" />
        </div>
    );
}