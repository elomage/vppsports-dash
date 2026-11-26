const STORAGE_KEY = "vppsports_dashboard_layout";
const TYPES = ["echart", "video", "info", "model", "metrics", "gps"];

export const DEFAULT_LAYOUT = [
    { id: 1, type: "echart", flexGrow: 1 },
    { id: 2, type: "video", flexGrow: 1 },
];

let layoutMemory = null;
let sliderMemory = { runId: null, value: 0 };

const sanitize = (list) => {
    if (!Array.isArray(list)) return null;
    return list
        .filter(
            (item) =>
                item &&
                item.id !== undefined &&
                TYPES.includes(item.type) &&
                Number.isFinite(Number(item.flexGrow)),
        )
        .map((item) => ({ id: item.id, type: item.type, flexGrow: Number(item.flexGrow) }));
};

export const loadLayout = () => {
    if (layoutMemory) return layoutMemory;
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const layout = sanitize(parsed?.layout);
        if (!layout) return null;
        layoutMemory = { layout, runId: parsed?.runId ?? null };
        return layoutMemory;
    } catch {
        return null;
    }
};

export const saveLayout = (layout, runId) => {
    layoutMemory = { layout, runId: runId ?? null };
    try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(layoutMemory));
    } catch {
        return;
    }
};

export const loadSlider = (runId) =>
    sliderMemory.runId === (runId ?? null) ? sliderMemory.value : 0;

export const saveSlider = (runId, value) => {
    sliderMemory = { runId: runId ?? null, value };
};