export async function gpxFileToCsvFile(file) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid GPX file.");

    const nodes = [...doc.getElementsByTagName("trkpt"), ...doc.getElementsByTagName("rtept")];
    const pts = nodes
        .map((n) => ({
            lat: parseFloat(n.getAttribute("lat")),
            lon: parseFloat(n.getAttribute("lon")),
            t: Date.parse(n.getElementsByTagName("time")[0]?.textContent ?? "") / 1000,
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    if (pts.length < 2) throw new Error("GPX needs at least 2 track points.");
    if (pts.some((p) => !Number.isFinite(p.t))) {
        throw new Error("GPX points need <time> values so the data can sync with playback.");
    }

    const t0 = pts[0].t;
    const rows = pts.map((p) => `${(p.t - t0).toFixed(3)},${p.lat.toFixed(7)},${p.lon.toFixed(7)}`);
    const csv = `timestamp,lat,lon\n${rows.join("\n")}\n`;
    return new File([csv], file.name.replace(/\.gpx$/i, "") + ".csv", { type: "text/csv" });
}