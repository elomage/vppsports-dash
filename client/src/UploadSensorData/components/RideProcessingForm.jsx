import { useEffect, useMemo, useState } from "react";
import {
    deleteRunSensor,
    fetchRunSensors,
    fetchRunTrims,
    fetchSelectedRun,
    fetchSensorRaw,
    updateRunTrims,
    uploadSensorDataCsv,
} from "../../api";
import RunSelect from "../RunSelect.jsx";
import StatusMessage from "../StatusMessage.jsx";
import RidePlot from "./RidePlot.jsx";
import {
    buildTrimmedCsv,
    computeFiltered,
    convertTimeUnit,
    detectIndices,
    detectTimeUnit,
    lowerBound,
    upperBound,
} from "../rideSignal.jsx";
import "./RideProcessing.css";

const IDLE = { type: "idle", message: "" };
const IDLE_LOAD = { status: "idle", message: "" };
const IDLE_COMPUTED = { status: "idle", result: null, raw: null, detected: null, error: "" };

const FILTER_TYPES = [
    { value: "none", label: "None" },
    { value: "kalman", label: "Kalman" },
    { value: "savgol", label: "Savitzky-Golay" },
];

const TIME_UNIT_OPTIONS = [
    { value: "auto", label: "Auto-detect" },
    { value: "s", label: "Seconds" },
    { value: "ms", label: "Milliseconds" },
    { value: "us", label: "Microseconds" },
];

const TRIM_MODES = [
    { value: "auto", label: "Auto trim" },
    { value: "manual", label: "Manual" },
    { value: "none", label: "No trim" },
];

const ACCEL_DEFAULTS = { type: "none", q: "0.1", r: "0.0001", window: "500", poly: "4" };
const GYRO_DEFAULTS = { type: "none", q: "0.1", r: "0.0001", window: "50", poly: "4" };

const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

const normalizeFilter = (cfg, defaults) => {
    if (cfg.type === "kalman") {
        return { type: "kalman", q: positive(cfg.q, Number(defaults.q)), r: positive(cfg.r, Number(defaults.r)) };
    }
    if (cfg.type === "savgol") {
        let window = Math.round(positive(cfg.window, Number(defaults.window)));
        if (window < 3) window = 3;
        if (window % 2 === 0) window += 1;
        let poly = Math.round(positive(cfg.poly, Number(defaults.poly)));
        if (poly >= window) poly = window - 1;
        return { type: "savgol", window, poly };
    }
    return { type: "none" };
};

const normalizeTrims = (list) =>
    (Array.isArray(list) ? list : [])
        .map((trim) => ({
            startTimestamp: Number(trim?.startTimestamp),
            endTimestamp: Number(trim?.endTimestamp),
        }))
        .filter((trim) => Number.isFinite(trim.startTimestamp) && Number.isFinite(trim.endTimestamp));

const round3 = (value) => String(Math.round(value * 1000) / 1000);

const safeName = (name) => String(name || "ride").replace(/[^\w.-]+/g, "_");

const sensorLabel = (sensor) => {
    const type = String(sensor.sensorType || "").trim();
    const name = String(sensor.name || "").trim();
    if (type && name) return `${type} - ${name}`;
    if (type) return `${type} (${sensor.sensorId})`;
    if (name) return name;
    return `Sensor ${sensor.sensorId}`;
};

const readingsToSeries = (readings) => {
    const list = Array.isArray(readings) ? readings : [];
    const t = new Float64Array(list.length);
    const x = new Float64Array(list.length);
    const y = new Float64Array(list.length);
    const z = new Float64Array(list.length);
    let used = 0;
    for (const reading of list) {
        const d = reading?.data;
        if (!Array.isArray(d) || d.length < 3) continue;
        const ts = Number(reading.timestamp);
        const a = Number(d[0]);
        const b = Number(d[1]);
        const c = Number(d[2]);
        if (![ts, a, b, c].every((value) => Number.isFinite(value))) continue;
        t[used] = ts;
        x[used] = a;
        y[used] = b;
        z[used] = c;
        used += 1;
    }
    const tt = t.slice(0, used);
    return { t: tt, x: x.slice(0, used), y: y.slice(0, used), z: z.slice(0, used), unit: detectTimeUnit(tt) };
};

const axisNames = (axes) =>
    Array.isArray(axes) && axes.length === 3 ? axes.map((a) => String(a)) : ["x", "y", "z"];

const withHeader = (csv, axes) => {
    const newline = csv.indexOf("\n");
    return `timestamp,${axisNames(axes).join(",")}${csv.slice(newline)}`;
};

const seriesToCsv = (series, axes) => {
    const rows = [`timestamp,${axisNames(axes).join(",")}`];
    for (let i = 0; i < series.t.length; i++) {
        rows.push(`${series.t[i]},${series.x[i]},${series.y[i]},${series.z[i]}`);
    }
    return `${rows.join("\n")}\n`;
};

const FilterControls = ({ idPrefix, title, cfg, onChange }) => {
    const set = (patch) => onChange({ ...cfg, ...patch });
    return (
        <div className="rp-filter">
            <div className="rp-subhead">{title}</div>
            <div className="rp-field">
                <label className="rp-label" htmlFor={`${idPrefix}-type`}>Filter</label>
                <select
                    id={`${idPrefix}-type`}
                    className="form-select"
                    value={cfg.type}
                    onChange={(e) => set({ type: e.target.value })}
                >
                    {FILTER_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>
            {cfg.type === "kalman" && (
                <div className="rp-grid2">
                    <div className="rp-field">
                        <label className="rp-label" htmlFor={`${idPrefix}-q`}>Q</label>
                        <input
                            id={`${idPrefix}-q`}
                            className="form-control"
                            type="number"
                            step="any"
                            min="0"
                            value={cfg.q}
                            onChange={(e) => set({ q: e.target.value })}
                        />
                    </div>
                    <div className="rp-field">
                        <label className="rp-label" htmlFor={`${idPrefix}-r`}>R</label>
                        <input
                            id={`${idPrefix}-r`}
                            className="form-control"
                            type="number"
                            step="any"
                            min="0"
                            value={cfg.r}
                            onChange={(e) => set({ r: e.target.value })}
                        />
                    </div>
                </div>
            )}
            {cfg.type === "savgol" && (
                <div className="rp-grid2">
                    <div className="rp-field">
                        <label className="rp-label" htmlFor={`${idPrefix}-window`}>Window</label>
                        <input
                            id={`${idPrefix}-window`}
                            className="form-control"
                            type="number"
                            step="1"
                            min="3"
                            value={cfg.window}
                            onChange={(e) => set({ window: e.target.value })}
                        />
                    </div>
                    <div className="rp-field">
                        <label className="rp-label" htmlFor={`${idPrefix}-poly`}>Polynomial</label>
                        <input
                            id={`${idPrefix}-poly`}
                            className="form-control"
                            type="number"
                            step="1"
                            min="1"
                            value={cfg.poly}
                            onChange={(e) => set({ poly: e.target.value })}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

const RideProcessingForm = ({ runs }) => {
    const [runId, setRunId] = useState("");
    const [sensors, setSensors] = useState([]);
    const [accelSensorId, setAccelSensorId] = useState("");
    const [gyroSensorId, setGyroSensorId] = useState("");
    const [source, setSource] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [loadState, setLoadState] = useState(IDLE_LOAD);
    const [timeUnit, setTimeUnit] = useState("auto");
    const [accelCfg, setAccelCfg] = useState(ACCEL_DEFAULTS);
    const [gyroCfg, setGyroCfg] = useState(GYRO_DEFAULTS);
    const [trimMode, setTrimMode] = useState("auto");
    const [manualStart, setManualStart] = useState("");
    const [manualEnd, setManualEnd] = useState("");
    const [saveFiltered, setSaveFiltered] = useState(true);
    const [axis, setAxis] = useState("ax");
    const [computed, setComputed] = useState(IDLE_COMPUTED);
    const [status, setStatus] = useState(IDLE);
    const [busy, setBusy] = useState("");

    const safeRuns = useMemo(() => (Array.isArray(runs) ? runs : []), [runs]);
    const accelClean = useMemo(() => normalizeFilter(accelCfg, ACCEL_DEFAULTS), [accelCfg]);
    const gyroClean = useMemo(() => normalizeFilter(gyroCfg, GYRO_DEFAULTS), [gyroCfg]);

    useEffect(() => {
        setSensors([]);
        setAccelSensorId("");
        setGyroSensorId("");
        setSource(null);
        setStatus(IDLE);
        setTrimMode("auto");
        setManualStart("");
        setManualEnd("");
        if (!runId) {
            setLoadState(IDLE_LOAD);
            return undefined;
        }
        let cancelled = false;
        setLoadState({ status: "loading", message: "Loading sensors…" });
        fetchRunSensors(runId)
            .then((list) => {
                if (cancelled) return;
                const safe = Array.isArray(list) ? list : [];
                setSensors(safe);
                const accel = safe.find((s) => /accel/i.test(String(s.sensorType || "")));
                const gyro = safe.find((s) => /gyro/i.test(String(s.sensorType || "")));
                setAccelSensorId(accel ? String(accel.sensorId) : "");
                setGyroSensorId(gyro ? String(gyro.sensorId) : "");
                if (safe.length === 0) {
                    setLoadState({ status: "error", message: "This run has no sensor data." });
                } else if (!accel) {
                    setLoadState({ status: "idle", message: "No accelerometer sensor was found. Pick one from the list." });
                } else {
                    setLoadState(IDLE_LOAD);
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setLoadState({
                        status: "error",
                        message: error instanceof Error ? error.message : "Could not load the sensors.",
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [runId]);

    useEffect(() => {
        if (!runId || accelSensorId === "") {
            setSource(null);
            return undefined;
        }
        let cancelled = false;
        setLoadState({ status: "loading", message: "Loading sensor data…" });
        (async () => {
            try {
                const accelReadings = await fetchSensorRaw(runId, Number(accelSensorId));
                const gyroReadings = gyroSensorId !== "" ? await fetchSensorRaw(runId, Number(gyroSensorId)) : null;
                if (cancelled) return;
                const accel = readingsToSeries(accelReadings);
                if (accel.t.length < 20) {
                    throw new Error("The selected accelerometer sensor has too few readings with 3 axes.");
                }
                const gyro = gyroReadings ? readingsToSeries(gyroReadings) : null;
                setSource({ accel, gyro });
                setLoadState(IDLE_LOAD);
            } catch (error) {
                if (!cancelled) {
                    setSource(null);
                    setLoadState({
                        status: "error",
                        message: error instanceof Error ? error.message : "Could not load the sensor data.",
                    });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [runId, accelSensorId, gyroSensorId, reloadKey]);

    useEffect(() => {
        if (!source) {
            setComputed(IDLE_COMPUTED);
            return undefined;
        }
        let cancelled = false;
        setComputed((prev) => ({ ...prev, status: "computing", error: "" }));
        const timer = setTimeout(() => {
            try {
                const acc = convertTimeUnit(source.accel, timeUnit === "auto" ? source.accel.unit : timeUnit);
                const gyro = source.gyro
                    ? convertTimeUnit(source.gyro, timeUnit === "auto" ? source.gyro.unit : timeUnit)
                    : null;
                const result = computeFiltered(acc, gyro, accelClean, gyroClean);
                const detected = detectIndices(result);
                if (!cancelled) {
                    setComputed({ status: "ready", result, raw: { acc, gyro }, detected, error: "" });
                }
            } catch (error) {
                if (!cancelled) {
                    setComputed({
                        status: "error",
                        result: null,
                        raw: null,
                        detected: null,
                        error: error instanceof Error ? error.message : "Processing failed.",
                    });
                }
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [source, timeUnit, accelClean, gyroClean]);

    const hasGyro = Boolean(computed.result?.gx);
    const axisOptions = hasGyro ? ["ax", "ay", "az", "gx", "gy", "gz"] : ["ax", "ay", "az"];
    const axisSafe = axisOptions.includes(axis) ? axis : "ax";

    const trim = useMemo(() => {
        const { result, detected } = computed;
        if (!result || !detected) return null;
        const { t } = result;
        const n = t.length;
        if (trimMode === "none") return { valid: true, start: 0, end: n, fallback: false };
        if (trimMode === "auto") {
            if (detected.end - detected.start >= 2) {
                return { valid: true, start: detected.start, end: detected.end, fallback: false };
            }
            return { valid: true, start: 0, end: n, fallback: true };
        }
        const s = Number(manualStart);
        const e = Number(manualEnd);
        if (manualStart === "" || manualEnd === "" || !Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
            return { valid: false, message: "Enter a start time smaller than the end time." };
        }
        const start = lowerBound(t, t[0] + s);
        const end = Math.min(n, upperBound(t, t[0] + e));
        if (end - start < 2) return { valid: false, message: "The selected window contains no samples." };
        return { valid: true, start, end, fallback: false };
    }, [computed, trimMode, manualStart, manualEnd]);

    const base = useMemo(() => {
        const { result, raw } = computed;
        if (!result || !raw) return null;
        const isAccel = axisSafe[0] === "a";
        const key = axisSafe[1];
        const times = isAccel ? result.t : result.tg;
        const rawValues = isAccel ? raw.acc[key] : raw.gyro?.[key];
        const filtered = result[axisSafe];
        if (!times || !rawValues || !filtered) return null;
        const origin = times[0];
        const rawPairs = new Array(times.length);
        const filteredPairs = new Array(times.length);
        for (let i = 0; i < times.length; i++) {
            const x = times[i] - origin;
            rawPairs[i] = [x, rawValues[i]];
            filteredPairs[i] = [x, filtered[i]];
        }
        return { isAccel, times, origin, rawPairs, filteredPairs };
    }, [computed, axisSafe]);

    const view = useMemo(() => {
        if (!base || !trim?.valid) return null;
        const { result } = computed;
        const tStart = result.t[trim.start];
        const tEnd = result.t[trim.end - 1];
        let from = trim.start;
        let to = trim.end;
        if (!base.isAccel) {
            from = lowerBound(base.times, tStart);
            to = upperBound(base.times, tEnd);
        }
        return {
            startRel: tStart - base.origin,
            endRel: tEnd - base.origin,
            duration: tEnd - tStart,
            trimmedPairs: base.filteredPairs.slice(from, to),
        };
    }, [base, trim, computed]);

    const rawSeries = useMemo(
        () => (base ? [{ name: "raw", color: "#64748b", width: 1, data: base.rawPairs }] : []),
        [base],
    );

    const filteredSeries = useMemo(() => {
        if (!base || !view) return [];
        if (trimMode === "none") {
            return [{ name: "full signal (no trim)", color: "#2563eb", width: 1.2, data: base.filteredPairs }];
        }
        return [
            { name: "full signal", color: "#94a3b8", width: 1, opacity: 0.7, data: base.filteredPairs },
            {
                name: "trim window",
                color: "#2563eb",
                width: 1.6,
                data: view.trimmedPairs,
                markers: { start: view.startRel, end: view.endRel },
            },
        ];
    }, [base, view, trimMode]);

    const sampleInfo = useMemo(() => {
        const { result } = computed;
        if (!result) return "";
        const n = result.t.length;
        const rate = (n - 1) / (result.t[n - 1] - result.t[0]);
        return `${n} samples at about ${rate.toFixed(1)} Hz`;
    }, [computed]);

    const detectedText = useMemo(() => {
        const { result, detected } = computed;
        if (!result || !detected) return "";
        const s = result.t[detected.start] - result.t[0];
        const e = result.t[Math.max(0, detected.end - 1)] - result.t[0];
        return `Detected window: ${s.toFixed(2)} s to ${e.toFixed(2)} s`;
    }, [computed]);

    const notes = [...(computed.result?.notes ?? [])];
    if (trim?.fallback) {
        notes.push({
            level: "warn",
            text: "Auto-detection returned an empty window, so the full signal is used. Switch to Manual to set the cut yourself.",
        });
    }

    const selectedRun = safeRuns.find((run) => run._id === runId);
    const runLabel = selectedRun?.name || runId;
    const ready = computed.status === "ready" && Boolean(computed.result) && Boolean(trim?.valid);
    const filterActive = accelClean.type !== "none" || gyroClean.type !== "none";
    const willSaveFiltered = filterActive && saveFiltered;
    const canApply = ready && !busy && (trimMode !== "none" || willSaveFiltered);

    const selectTrimMode = (next) => {
        setStatus(IDLE);
        if (next === "manual" && computed.result && trim?.valid) {
            const { t } = computed.result;
            setManualStart(round3(t[trim.start] - t[0]));
            setManualEnd(round3(t[trim.end - 1] - t[0]));
        }
        setTrimMode(next);
    };

    const handleClear = () => {
        setRunId("");
        setStatus(IDLE);
    };

    const replaceSensors = async () => {
        const n = computed.result.t.length;
        const out = buildTrimmedCsv(computed.result, 0, n, false, true);
        const jobs = [];
        if (accelClean.type !== "none" && accelSensorId !== "") {
            jobs.push({ type: "accelerometer", sensorId: Number(accelSensorId), csv: out.accel, backup: source.accel });
        }
        if (gyroClean.type !== "none" && out.gyro && gyroSensorId !== "" && source.gyro) {
            jobs.push({ type: "gyroscope", sensorId: Number(gyroSensorId), csv: out.gyro, backup: source.gyro });
        }
        for (const job of jobs) {
            const meta = sensors.find((s) => Number(s.sensorId) === job.sensorId);
            const options = {
                runId,
                sensorType: job.type,
                sensorId: job.sensorId,
                sensorName: String(meta?.name || "").trim(),
            };
            const fileName = `${safeName(runLabel)}_${job.type}.csv`;
            await deleteRunSensor(runId, job.sensorId);
            try {
                await uploadSensorDataCsv(
                    new File([withHeader(job.csv, meta?.axes)], fileName, { type: "text/csv" }),
                    options,
                );
            } catch (error) {
                await uploadSensorDataCsv(
                    new File([seriesToCsv(job.backup, meta?.axes)], fileName, { type: "text/csv" }),
                    options,
                );
                throw error;
            }
        }
        return jobs.length;
    };

    const handleApply = async () => {
        if (!canApply) return;
        setBusy("apply");
        setStatus({ type: "info", message: "Saving…" });
        try {
            const ts = source.accel.t;
            const n = ts.length;
            const { start, end } = trim;
            const newTrims = [];

            const run = await fetchSelectedRun(runId);
            const allTs = Array.isArray(run?.totalTimestamps) ? run.totalTimestamps : [];
            const firstTs = allTs.length ? Math.min(allTs[0], ts[0]) : ts[0];
            const lastTs = allTs.length ? Math.max(allTs[allTs.length - 1], ts[n - 1]) : ts[n - 1];

            if (start > 0) {
                newTrims.push({ startTimestamp: firstTs, endTimestamp: (ts[start - 1] + ts[start]) / 2 });
            }
            if (end < n) {
                newTrims.push({ startTimestamp: (ts[end - 1] + ts[end]) / 2, endTimestamp: lastTs });
            }

            let replaced = 0;
            if (willSaveFiltered) {
                replaced = await replaceSensors();
            }

            if (newTrims.length > 0) {
                let existing = run?.trims;
                if (!Array.isArray(existing)) {
                    const fetched = await fetchRunTrims(runId);
                    existing = Array.isArray(fetched) ? fetched : fetched?.trims;
                }
                await updateRunTrims(runId, [...normalizeTrims(existing), ...newTrims]);
            }

            if (newTrims.length === 0 && replaced === 0) {
                setStatus({ type: "info", message: "Nothing to save: the window covers the whole ride and no filter is active." });
                return;
            }

            const parts = [];
            if (replaced > 0) parts.push(`${replaced} sensor${replaced > 1 ? "s" : ""} replaced with filtered data`);
            if (newTrims.length > 0) parts.push("cut applied");

            const refreshed = await fetchRunSensors(runId);
            setSensors(Array.isArray(refreshed) ? refreshed : []);
            if (replaced > 0) {
                setAccelCfg(ACCEL_DEFAULTS);
                setGyroCfg(GYRO_DEFAULTS);
                setReloadKey((value) => value + 1);
            }

            setStatus({
                type: "success",
                message: `"${runLabel}": ${parts.join(" and ")}. Select the run again in the dashboard to see it. The cut can be undone under Trim Data in the graph.`,
            });
        } catch (error) {
            setStatus({
                type: "error",
                message: error instanceof Error ? error.message : "Could not save.",
            });
        } finally {
            setBusy("");
        }
    };

    return (
        <div className="us-form">
            <fieldset className="us-group" disabled={Boolean(busy)}>
                <legend className="us-legend">Ride</legend>
                <div className="rp-body">
                    <div className="rp-field">
                        <label className="rp-label" htmlFor="rp-run">Run</label>
                        <RunSelect id="rp-run" runs={safeRuns} value={runId} onChange={setRunId} />
                    </div>

                    {runId && sensors.length > 0 && (
                        <>
                            <div className="rp-grid2">
                                <div className="rp-field">
                                    <label className="rp-label" htmlFor="rp-accel-sensor">Accelerometer sensor</label>
                                    <select
                                        id="rp-accel-sensor"
                                        className="form-select"
                                        value={accelSensorId}
                                        onChange={(e) => setAccelSensorId(e.target.value)}
                                    >
                                        <option value="">Select a sensor</option>
                                        {sensors.map((sensor) => (
                                            <option key={sensor.sensorId} value={String(sensor.sensorId)}>
                                                {sensorLabel(sensor)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="rp-field">
                                    <label className="rp-label" htmlFor="rp-gyro-sensor">
                                        Gyroscope sensor <span className="us-optional">optional</span>
                                    </label>
                                    <select
                                        id="rp-gyro-sensor"
                                        className="form-select"
                                        value={gyroSensorId}
                                        onChange={(e) => setGyroSensorId(e.target.value)}
                                    >
                                        <option value="">None</option>
                                        {sensors.map((sensor) => (
                                            <option key={sensor.sensorId} value={String(sensor.sensorId)}>
                                                {sensorLabel(sensor)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="rp-grid2">
                                <div className="rp-field">
                                    <label className="rp-label" htmlFor="rp-time-unit">Timestamp unit</label>
                                    <select
                                        id="rp-time-unit"
                                        className="form-select"
                                        value={timeUnit}
                                        onChange={(e) => setTimeUnit(e.target.value)}
                                    >
                                        {TIME_UNIT_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                    {source && timeUnit === "auto" && (
                                        <span className="rp-meta">Detected unit: {source.accel.unit}</span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {!runId && <p className="rp-meta">Select an uploaded run that has accelerometer data to start.</p>}
                    {loadState.message && (
                        <p className={`rp-meta ${loadState.status === "error" ? "is-error" : ""}`}>{loadState.message}</p>
                    )}
                </div>
            </fieldset>

            {source && (
                <>
                    <fieldset className="us-group" disabled={Boolean(busy)}>
                        <legend className="us-legend">Signal filters</legend>
                        <div className="rp-cols">
                            <FilterControls idPrefix="rp-accel" title="Accelerometer" cfg={accelCfg} onChange={setAccelCfg} />
                            <FilterControls idPrefix="rp-gyro" title="Gyroscope" cfg={gyroCfg} onChange={setGyroCfg} />
                        </div>
                    </fieldset>

                    <fieldset className="us-group" disabled={Boolean(busy)}>
                        <legend className="us-legend">Cut ride</legend>
                        <div className="rp-body">
                            <div className="us-segmented" role="group" aria-label="Trim mode">
                                {TRIM_MODES.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        className={trimMode === option.value ? "is-on" : ""}
                                        aria-pressed={trimMode === option.value}
                                        onClick={() => selectTrimMode(option.value)}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            {trimMode === "manual" && (
                                <div className="rp-grid2">
                                    <div className="rp-field">
                                        <label className="rp-label" htmlFor="rp-manual-start">Start (s)</label>
                                        <input
                                            id="rp-manual-start"
                                            className="form-control"
                                            type="number"
                                            step="any"
                                            value={manualStart}
                                            onChange={(e) => setManualStart(e.target.value)}
                                        />
                                    </div>
                                    <div className="rp-field">
                                        <label className="rp-label" htmlFor="rp-manual-end">End (s)</label>
                                        <input
                                            id="rp-manual-end"
                                            className="form-control"
                                            type="number"
                                            step="any"
                                            value={manualEnd}
                                            onChange={(e) => setManualEnd(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}
                            {trim && !trim.valid && <p className="rp-meta is-warn">{trim.message}</p>}
                            {detectedText && <p className="rp-meta">{detectedText}</p>}
                        </div>
                    </fieldset>

                    {computed.status === "computing" && <p className="rp-meta">Processing…</p>}
                    {computed.status === "error" && (
                        <div className="us-status is-error" role="alert">{computed.error}</div>
                    )}

                    {base && view && (
                        <fieldset className="us-group">
                            <legend className="us-legend">Preview</legend>
                            <div className="rp-body">
                                <div className="rp-row">
                                    <label className="rp-label" htmlFor="rp-axis">Axis</label>
                                    <select
                                        id="rp-axis"
                                        className="form-select rp-axis"
                                        value={axisSafe}
                                        onChange={(e) => setAxis(e.target.value)}
                                    >
                                        {axisOptions.map((option) => (
                                            <option key={option} value={option}>{option}</option>
                                        ))}
                                    </select>
                                    <span className="rp-meta">{sampleInfo}</span>
                                    <span className="rp-duration">Window: {view.duration.toFixed(2)} s</span>
                                </div>
                                <div className="rp-plots">
                                    <RidePlot title={`Raw · ${axisSafe}`} series={rawSeries} />
                                    <RidePlot
                                        title={`${trimMode === "none" ? "Filtered" : "Filtered + trimmed"} · ${axisSafe}`}
                                        series={filteredSeries}
                                    />
                                </div>
                                {notes.length > 0 && (
                                    <ul className="rp-notes">
                                        {notes.map((note, index) => (
                                            <li key={index} className={note.level === "warn" ? "is-warn" : ""}>{note.text}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </fieldset>
                    )}

                    <fieldset className="us-group" disabled={Boolean(busy)}>
                        <legend className="us-legend">Save result</legend>
                        <div className="rp-body">
                            <div className="rp-card">
                                <div className="rp-card-title">Apply to this run</div>
                                <p className="rp-meta">
                                    Hides everything outside the window in the dashboard. The cut can be undone under Trim Data
                                    in the graph.
                                </p>
                                {filterActive && (
                                    <label className="rp-check">
                                        <input
                                            type="checkbox"
                                            checked={saveFiltered}
                                            onChange={(e) => setSaveFiltered(e.target.checked)}
                                        />
                                        <span>Replace the sensor data in this run with the filtered signal</span>
                                    </label>
                                )}
                                <div className="rp-actions">
                                    <button className="us-btn us-btn--primary" type="button" onClick={handleApply} disabled={!canApply}>
                                        {busy === "apply" ? "Saving…" : "Apply to run"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </fieldset>
                </>
            )}

            <StatusMessage status={status} />

            {runId && (
                <div className="rp-actions">
                    <button className="us-btn us-btn--ghost" type="button" onClick={handleClear} disabled={Boolean(busy)}>
                        Clear
                    </button>
                </div>
            )}
        </div>
    );
};

export default RideProcessingForm;