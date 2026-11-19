import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchRunSensors, fetchSensorRaw } from "../api";
import "./GpsVisualizer.css";

/* ---------- reading GPS out of stored sensor data ---------- */

const isGpsSensor = (s) => String(s?.sensorType ?? "").toLowerCase() === "gps";

// lat/lon are positions inside reading.data; axes (if present) tell us which
function buildTrack(readings, axes) {
    const find = (names, fallback) => {
        const i = Array.isArray(axes)
            ? axes.findIndex((a) => names.includes(String(a).toLowerCase()))
            : -1;
        return i >= 0 ? i : fallback;
    };
    const latI = find(["lat", "latitude"], 0);
    const lonI = find(["lon", "lng", "long", "longitude"], 1);

    const pts = readings
        .map((r) => ({
            lat: Number(r.data?.[latI]),
            lon: Number(r.data?.[lonI]),
            t: Number(r.timestamp),
        }))
        .filter(
            (p) =>
                Number.isFinite(p.lat) &&
                Number.isFinite(p.lon) &&
                Math.abs(p.lat) <= 90 &&
                Math.abs(p.lon) <= 180,
        );

    if (pts.length < 2) return null;

    const t0 = pts[0].t;
    const hasTime = pts.every((p) => Number.isFinite(p.t)) && pts[pts.length - 1].t > t0;
    const points = pts.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        t: hasTime ? p.t - t0 : null,
    }));
    return { points, hasTime, duration: hasTime ? points[points.length - 1].t : null };
}

/* ---------- component ---------- */

export default function GpsVisualizer({
                                          sliderValue = 0,
                                          setSliderValue,
                                          removeFunction,
                                          selectedRun,
                                          effectiveTimestamps,
                                      }) {
    const [state, setState] = useState({ status: "loading", track: null, message: "" });
    const { status, track, message } = state;

    const mapElRef = useRef(null);
    const cursorRef = useRef(null);

    const runId = selectedRun?._id;
    const totalSteps = (effectiveTimestamps || selectedRun?.totalTimestamps || []).length;
    const frac = totalSteps > 1 ? Math.min(1, Math.max(0, sliderValue / (totalSteps - 1))) : 0;

    // load the run's GPS sensor from the DB
    useEffect(() => {
        if (!runId) {
            setState({ status: "empty", track: null, message: "No run selected." });
            return undefined;
        }

        let cancelled = false;
        setState({ status: "loading", track: null, message: "" });

        (async () => {
            try {
                const sensors = await fetchRunSensors(runId);
                const gpsSensors = sensors.filter(isGpsSensor);
                if (gpsSensors.length === 0) {
                    if (!cancelled) {
                        setState({ status: "empty", track: null, message: "No GPS data for this run." });
                    }
                    return;
                }

                let sampleInfo = "";
                for (const sensor of gpsSensors) {
                    const readings = await fetchSensorRaw(runId, sensor.sensorId);
                    if (cancelled) return;
                    if (!sampleInfo) {
                        sampleInfo = ` axes: ${JSON.stringify(sensor.axes)}, first reading: ${JSON.stringify(readings[0] ?? null)}`;
                    }
                    const built = buildTrack(readings, sensor.axes);
                    if (built) {
                        setState({ status: "ready", track: built, message: "" });
                        return;
                    }
                }

                if (!cancelled) {
                    setState({
                        status: "error",
                        track: null,
                        message: `GPS sensor found, but lat/lon could not be read.${sampleInfo}`,
                    });
                }
            } catch (e) {
                if (!cancelled) {
                    setState({
                        status: "error",
                        track: null,
                        message: e instanceof Error ? e.message : "Could not load GPS data.",
                    });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [runId]);

    // keep the latest values available to the map's click handler
    const latest = useRef({});
    latest.current = { track, totalSteps, setSliderValue };

    // build the map whenever a track is loaded
    useEffect(() => {
        if (!track || !mapElRef.current) return undefined;

        const map = L.map(mapElRef.current, { zoomControl: true });

        L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
                maxZoom: 19,
                maxNativeZoom: 18,
                attribution:
                    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
            },
        ).addTo(map);

        const latlngs = track.points.map((p) => [p.lat, p.lon]);
        const line = L.polyline(latlngs, { color: "#facc15", weight: 4, opacity: 0.95 }).addTo(map);

        L.circleMarker(latlngs[0], {
            radius: 7,
            color: "#fff",
            weight: 2,
            fillColor: "#16a34a",
            fillOpacity: 1,
        }).addTo(map);
        L.circleMarker(latlngs[latlngs.length - 1], {
            radius: 7,
            color: "#fff",
            weight: 2,
            fillColor: "#dc2626",
            fillOpacity: 1,
        }).addTo(map);

        cursorRef.current = L.circleMarker(latlngs[0], {
            radius: 9,
            color: "#111",
            weight: 3,
            fillColor: "#fff",
            fillOpacity: 1,
        }).addTo(map);

        map.fitBounds(line.getBounds(), { padding: [24, 24] });

        // click the map to jump the playback slider to the nearest track point
        map.on("click", (e) => {
            const { track: tr, totalSteps: n, setSliderValue: setSlider } = latest.current;
            if (!tr || !setSlider || n < 2) return;
            const k = Math.cos((e.latlng.lat * Math.PI) / 180);
            let best = 0;
            let bestD = Infinity;
            tr.points.forEach((p, i) => {
                const d = (p.lat - e.latlng.lat) ** 2 + ((p.lon - e.latlng.lng) * k) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            });
            const f =
                tr.hasTime && tr.duration
                    ? tr.points[best].t / tr.duration
                    : best / (tr.points.length - 1);
            setSlider(Math.round(f * (n - 1)));
        });

        // dashboard cards are resizable, so keep Leaflet in sync with the container size
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapElRef.current);

        return () => {
            ro.disconnect();
            map.remove();
            cursorRef.current = null;
        };
    }, [track]);

    // move the cursor with the playback slider
    useEffect(() => {
        if (!track || !cursorRef.current) return;
        const { points, hasTime, duration } = track;
        let idx;
        if (!hasTime || !duration) {
            idx = Math.round(frac * (points.length - 1));
        } else {
            const target = frac * duration;
            let lo = 0;
            let hi = points.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (points[mid].t < target) lo = mid + 1;
                else hi = mid;
            }
            idx = lo;
        }
        cursorRef.current.setLatLng([points[idx].lat, points[idx].lon]);
    }, [track, frac]);

    return (
        <div className="gps-viz">
            <div className="gps-head">
                <strong>GPS map</strong>
                {removeFunction && (
                    <button
                        type="button"
                        className="gps-close"
                        onClick={removeFunction}
                        aria-label="Remove GPS view"
                    >
                        ✕
                    </button>
                )}
            </div>

            <div className="gps-body">
                {status === "ready" ? (
                    <div ref={mapElRef} className="gps-map" />
                ) : (
                    <p className={`gps-msg ${status === "error" ? "is-error" : ""}`}>
                        {status === "loading" ? "Loading GPS data…" : message}
                    </p>
                )}
            </div>
        </div>
    );
}