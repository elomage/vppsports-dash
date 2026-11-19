export const SENSOR_SCALE = 19.5 / 1000000;
export const TIME_UNITS = { s: 1, ms: 1000, us: 1000000 };

const median = (arr) => {
    const n = arr.length;
    if (n === 0) return 0;
    const sorted = Float64Array.from(arr).sort();
    const mid = n >> 1;
    return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const variance = (arr) => {
    const n = arr.length;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arr[i];
    const mean = sum / n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
        const d = arr[i] - mean;
        acc += d * d;
    }
    return acc / n;
};

const addScalar = (arr, value) => {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] + value;
    return out;
};

const negate = (arr) => {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = -arr[i];
    return out;
};

const maximumAccumulate = (arr) => {
    const out = new Float64Array(arr.length);
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
        out[i] = max;
    }
    return out;
};

export const lowerBound = (arr, target) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};

export const upperBound = (arr, target) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
};

export function parseRideText(text) {
    const t = [];
    const x = [];
    const y = [];
    const z = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/[,;\t ]+/);
        if (parts.length !== 4) continue;
        const nums = parts.map(Number);
        if (nums.some((value) => !Number.isFinite(value))) continue;
        t.push(nums[0]);
        x.push(nums[1]);
        y.push(nums[2]);
        z.push(nums[3]);
    }
    return {
        t: Float64Array.from(t),
        x: Float64Array.from(x),
        y: Float64Array.from(y),
        z: Float64Array.from(z),
    };
}

export function detectTimeUnit(t) {
    if (t.length < 2) return "s";
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < t.length; i++) {
        if (t[i] < min) min = t[i];
        if (t[i] > max) max = t[i];
    }
    const span = max - min;
    if (span >= 1e7) return "us";
    if (span >= 5000) return "ms";
    return "s";
}

export function convertTimeUnit(parsed, unit) {
    const factor = TIME_UNITS[unit] || 1;
    const t = new Float64Array(parsed.t.length);
    for (let i = 0; i < t.length; i++) t[i] = parsed.t[i] / factor;
    return { t, x: parsed.x, y: parsed.y, z: parsed.z };
}

const scaleAcc = (arr, threshold = 100) => {
    let maxAbs = 0;
    for (let i = 0; i < arr.length; i++) {
        const a = Math.abs(arr[i]);
        if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs < threshold) return arr;
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] * SENSOR_SCALE;
    return out;
};

function kalmanAxis(signal, t, q, r) {
    const n = signal.length;
    const out = new Float64Array(n);
    const meanDt = n > 1 ? (t[n - 1] - t[0]) / (n - 1) : 0.01;
    let x0 = 0;
    let x1 = 0;
    let p00 = 1;
    let p01 = 0;
    let p10 = 0;
    let p11 = 1;
    for (let i = 0; i < n; i++) {
        let dt = 0.01;
        if (i > 0) {
            dt = t[i] - t[i - 1];
            if (dt <= 0) dt = meanDt;
        }
        x0 += dt * x1;
        const a00 = p00 + dt * p10;
        const a01 = p01 + dt * p11;
        const a10 = p10;
        const a11 = p11;
        const q00 = (q * dt ** 4) / 4;
        const q01 = (q * dt ** 3) / 2;
        const q11 = q * dt ** 2;
        p00 = a00 + a01 * dt + q00;
        p01 = a01 + q01;
        p10 = a10 + a11 * dt + q01;
        p11 = a11 + q11;
        const innovation = signal[i] - x0;
        const s = p00 + r;
        const k0 = p00 / s;
        const k1 = p10 / s;
        x0 += k0 * innovation;
        x1 += k1 * innovation;
        const n00 = p00 - k0 * p00;
        const n01 = p01 - k0 * p01;
        const n10 = p10 - k1 * p00;
        const n11 = p11 - k1 * p01;
        p00 = n00;
        p01 = n01;
        p10 = n10;
        p11 = n11;
        out[i] = x0;
    }
    return out;
}

function invertMatrix(matrix) {
    const n = matrix.length;
    const m = matrix.map((row, i) => [
        ...row,
        ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    ]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
        }
        if (Math.abs(m[pivot][col]) < 1e-14) return null;
        [m[col], m[pivot]] = [m[pivot], m[col]];
        const div = m[col][col];
        for (let c = 0; c < 2 * n; c++) m[col][c] /= div;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = m[r][col];
            if (factor === 0) continue;
            for (let c = 0; c < 2 * n; c++) m[r][c] -= factor * m[col][c];
        }
    }
    return m.map((row) => row.slice(n));
}

function savgolSetup(window, poly) {
    const half = (window - 1) / 2;
    const size = poly + 1;
    const powers = new Float64Array(window * size);
    for (let k = 0; k < window; k++) {
        const x = (k - half) / half;
        let pw = 1;
        for (let j = 0; j < size; j++) {
            powers[k * size + j] = pw;
            pw *= x;
        }
    }
    const normal = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            let sum = 0;
            for (let k = 0; k < window; k++) sum += powers[k * size + i] * powers[k * size + j];
            normal[i][j] = sum;
        }
    }
    const inv = invertMatrix(normal);
    if (!inv) return null;
    const coeffs = new Float64Array(window);
    for (let k = 0; k < window; k++) {
        let sum = 0;
        for (let j = 0; j < size; j++) sum += inv[0][j] * powers[k * size + j];
        coeffs[k] = sum;
    }
    return { half, size, powers, inv, coeffs };
}

function savgolAxis(signal, window = 11, poly = 3) {
    const n = signal.length;
    let w = window;
    if (n < w) return signal;
    if (w % 2 === 0) w += 1;
    if (w >= n) return signal;
    const setup = savgolSetup(w, Math.min(poly, w - 1));
    if (!setup) return signal;
    const { half, size, powers, inv, coeffs } = setup;
    const out = new Float64Array(n);
    for (let i = half; i < n - half; i++) {
        const base = i - half;
        let acc = 0;
        for (let k = 0; k < w; k++) acc += coeffs[k] * signal[base + k];
        out[i] = acc;
    }
    const fitEdge = (start, from, to) => {
        const rhs = new Float64Array(size);
        for (let k = 0; k < w; k++) {
            for (let j = 0; j < size; j++) rhs[j] += powers[k * size + j] * signal[start + k];
        }
        const b = new Float64Array(size);
        for (let i = 0; i < size; i++) {
            let sum = 0;
            for (let j = 0; j < size; j++) sum += inv[i][j] * rhs[j];
            b[i] = sum;
        }
        for (let idx = from; idx < to; idx++) {
            const kk = idx - start;
            let value = 0;
            for (let j = 0; j < size; j++) value += b[j] * powers[kk * size + j];
            out[idx] = value;
        }
    };
    fitEdge(0, 0, half);
    fitEdge(n - w, n - half, n);
    return out;
}

function applyFilter(signal, t, cfg) {
    const type = cfg?.type ?? "none";
    if (type === "kalman") return kalmanAxis(signal, t, cfg.q, cfg.r);
    if (type === "savgol") return savgolAxis(signal, cfg.window, cfg.poly);
    return signal;
}

export function detectRideStart(t, ax, windowSec = 0.5) {
    const n = ax.length;
    if (n < 8) return 0;
    const dt = new Float64Array(n - 1);
    let sum = 0;
    for (let i = 0; i < n - 1; i++) {
        dt[i] = t[i + 1] - t[i];
        sum += dt[i];
    }
    const rawMean = sum / (n - 1);
    let fixedSum = 0;
    for (let i = 0; i < n - 1; i++) {
        if (dt[i] <= 0) dt[i] = rawMean;
        fixedSum += dt[i];
    }
    const meanDt = fixedSum / (n - 1);
    if (!(meanDt > 0)) return 0;
    const win = Math.max(5, Math.trunc(windowSec / meanDt));
    if (win >= n) return 0;
    const count = n - 1 - win;
    if (count <= 0) return 0;

    let axMean = 0;
    for (let i = 0; i < n; i++) axMean += ax[i];
    axMean /= n;
    const ps = new Float64Array(n + 1);
    const ps2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
        const v = ax[i] - axMean;
        ps[i + 1] = ps[i] + v;
        ps2[i + 1] = ps2[i] + v * v;
    }
    const pj = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
        pj[i + 1] = pj[i] + Math.abs((ax[i + 1] - ax[i]) / dt[i]);
    }

    const combined = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        const mean = (ps[i + win] - ps[i]) / win;
        const variance = Math.max(0, (ps2[i + win] - ps2[i]) / win - mean * mean);
        const jerk = (pj[i + win] - pj[i]) / win;
        combined[i] = variance + jerk;
    }

    const sorted = Float64Array.from(combined).sort();
    const pos = 0.9 * (count - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const threshold = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    for (let i = 0; i < count; i++) {
        if (combined[i] > threshold) return i;
    }
    return 0;
}

export function detectRideEnd(t, az, minRunDuration = 40, curveThreshold = 0.8, finishBuffer = 0.5) {
    const n = t.length;
    if (n < 3) return Math.max(0, n - 1);
    const diffs = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) diffs[i] = t[i + 1] - t[i];
    const medDt = median(diffs);
    if (!(medDt > 0)) return n - 1;
    const fs = 1 / medDt;
    const w = Math.max(2, Math.trunc(0.2 * fs));
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + Math.abs(az[i]);
    const offset = Math.floor((w - 1) / 2);
    const smooth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const k = i + offset;
        const upper = Math.min(n - 1, k);
        const lower = Math.max(0, k - w + 1);
        smooth[i] = (prefix[upper + 1] - prefix[lower]) / w;
    }
    const searchStart = Math.trunc(minRunDuration * fs);
    const lastAbove = (threshold) => {
        for (let i = n - 1; i >= searchStart; i--) {
            if (smooth[i] > threshold) return i;
        }
        return -1;
    };
    let lastPeak = lastAbove(curveThreshold);
    if (lastPeak < 0) lastPeak = lastAbove(1.0);
    if (lastPeak < 0) return n - 1;
    let preciseExit = lastPeak;
    for (let i = lastPeak; i < n; i++) {
        if (smooth[i] < 0.4) {
            preciseExit = i;
            break;
        }
    }
    const finalIdx = preciseExit + Math.trunc(finishBuffer * fs);
    return Math.min(n - 1, Math.max(0, finalIdx));
}

function estimateGravity(ax, ay, az, startIdx, fs, notes) {
    const searchSamples = Math.trunc(30 * fs);
    const subSamples = Math.trunc(2 * fs);
    const searchStart = Math.max(0, startIdx - searchSamples);
    const searchEnd = startIdx;
    const fallback = () =>
        startIdx > 0
            ? [median(ax.subarray(0, startIdx)), median(ay.subarray(0, startIdx)), median(az.subarray(0, startIdx))]
            : [0, 0, 1];
    if (subSamples < 2 || searchEnd - searchStart <= subSamples) return fallback();

    const candidates = [];
    const step = Math.max(1, subSamples >> 2);
    for (let i = searchStart; i < searchEnd - subSamples; i += step) {
        const sx = ax.subarray(i, i + subSamples);
        const sy = ay.subarray(i, i + subSamples);
        const sz = az.subarray(i, i + subSamples);
        const gx = median(sx);
        const gy = median(sy);
        const gz = median(sz);
        candidates.push({
            variance: variance(sx) + variance(sy) + variance(sz),
            mag: Math.sqrt(gx * gx + gy * gy + gz * gz),
            gx,
            gy,
            gz,
        });
    }
    if (candidates.length === 0) return fallback();

    const valid = candidates
        .filter((c) => c.mag >= 0.85 && c.mag <= 1.15)
        .sort((a, b) => a.variance - b.variance);
    if (valid.length > 0) {
        const best = valid[0];
        notes.push({ level: "info", text: `Gravity estimated from a physically plausible window: ${best.mag.toFixed(3)} g.` });
        return [best.gx, best.gy, best.gz];
    }
    candidates.sort((a, b) => a.variance - b.variance);
    const best = candidates[0];
    notes.push({
        level: "warn",
        text: `No window with gravity between 0.85 and 1.15 g. Used the lowest-variance window (${best.mag.toFixed(3)} g), so the ride may be scaled incorrectly.`,
    });
    return [best.gx, best.gy, best.gz];
}

function autoFlip(ax, ay, az) {
    const baseline = median(az);
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < az.length; i++) {
        if (az[i] > max) max = az[i];
        if (az[i] < min) min = az[i];
    }
    if (baseline - min > max - baseline) {
        return { ax: negate(ax), ay: negate(ay), az: negate(az), flipped: true };
    }
    return { ax, ay, az, flipped: false };
}

function subtractGyroBias(gx, gy, gz, startIdx, fs) {
    const searchSamples = Math.trunc(30 * fs);
    const subSamples = Math.trunc(2 * fs);
    const searchStart = Math.max(0, startIdx - searchSamples);
    const searchEnd = startIdx;
    if (searchEnd - searchStart < subSamples) {
        const bx = startIdx > 0 ? median(gx.subarray(0, startIdx)) : 0;
        const by = startIdx > 0 ? median(gy.subarray(0, startIdx)) : 0;
        const bz = startIdx > 0 ? median(gz.subarray(0, startIdx)) : 0;
        return [addScalar(gx, -bx), addScalar(gy, -by), addScalar(gz, -bz)];
    }
    let bestVar = Infinity;
    let bestStart = searchStart;
    const step = Math.max(1, subSamples >> 2);
    for (let i = searchStart; i < searchEnd - subSamples; i += step) {
        const v =
            variance(gx.subarray(i, i + subSamples)) +
            variance(gy.subarray(i, i + subSamples)) +
            variance(gz.subarray(i, i + subSamples));
        if (v < bestVar) {
            bestVar = v;
            bestStart = i;
        }
    }
    const bestEnd = bestStart + subSamples;
    return [
        addScalar(gx, -median(gx.subarray(bestStart, bestEnd))),
        addScalar(gy, -median(gy.subarray(bestStart, bestEnd))),
        addScalar(gz, -median(gz.subarray(bestStart, bestEnd))),
    ];
}

export function resampleSignal(tSrc, signal, tTarget) {
    const m = tSrc.length;
    const out = new Float64Array(tTarget.length);
    if (m < 2) return out;
    for (let i = 0; i < tTarget.length; i++) {
        const x = tTarget[i];
        let hi = lowerBound(tSrc, x);
        if (hi <= 0) hi = 1;
        if (hi >= m) hi = m - 1;
        const lo = hi - 1;
        const dx = tSrc[hi] - tSrc[lo];
        if (dx > 0) {
            out[i] = signal[lo] + ((signal[hi] - signal[lo]) / dx) * (x - tSrc[lo]);
        } else {
            out[i] = signal[lo];
        }
    }
    return out;
}

export function computeFiltered(acc, gyro, accelFilter, gyroFilter) {
    const notes = [];
    const t = maximumAccumulate(acc.t);
    const n = t.length;
    if (n < 20) throw new Error("The accelerometer file has too few samples.");
    const meanDt = (t[n - 1] - t[0]) / (n - 1);
    if (!(meanDt > 0)) throw new Error("Accelerometer timestamps do not increase. Check the timestamp unit.");
    const fs = 1 / meanDt;
    if (fs < 5) {
        notes.push({ level: "warn", text: `Sampling rate is only ${fs.toFixed(2)} Hz. Check the timestamp unit.` });
    }

    let ax = applyFilter(scaleAcc(acc.x), t, accelFilter);
    let ay = applyFilter(scaleAcc(acc.y), t, accelFilter);
    let az = applyFilter(scaleAcc(acc.z), t, accelFilter);

    const startIdx = detectRideStart(t, ax);
    const [gravX, gravY, gravZ] = estimateGravity(ax, ay, az, startIdx, fs, notes);
    ax = addScalar(ax, -gravX);
    ay = addScalar(ay, -gravY);
    az = addScalar(az, -gravZ);

    const oriented = autoFlip(ax, ay, az);
    ax = oriented.ax;
    ay = oriented.ay;
    az = oriented.az;
    if (oriented.flipped) {
        notes.push({ level: "info", text: "Signal flipped because the dominant vertical deviation was negative." });
    }

    let tg = null;
    let gx = null;
    let gy = null;
    let gz = null;
    if (gyro) {
        if (gyro.t.length < 20) {
            notes.push({ level: "warn", text: "The gyroscope file has too few samples and was ignored." });
        } else {
            const tgAcc = maximumAccumulate(gyro.t);
            const m = tgAcc.length;
            const gMean = (tgAcc[m - 1] - tgAcc[0]) / (m - 1);
            if (gMean > 0) {
                const fx = applyFilter(gyro.x, tgAcc, gyroFilter);
                const fy = applyFilter(gyro.y, tgAcc, gyroFilter);
                const fz = applyFilter(gyro.z, tgAcc, gyroFilter);
                const gStart = lowerBound(tgAcc, t[startIdx]);
                const biased = subtractGyroBias(fx, fy, fz, gStart, 1 / gMean);
                tg = tgAcc;
                gx = biased[0];
                gy = biased[1];
                gz = biased[2];
            } else {
                notes.push({ level: "warn", text: "Gyroscope timestamps do not increase, so the gyroscope was ignored." });
            }
        }
    }

    return { t, ax, ay, az, tg, gx, gy, gz, notes };
}

export function detectIndices(result) {
    return {
        start: detectRideStart(result.t, result.ax),
        end: detectRideEnd(result.t, result.az),
    };
}

export function buildTrimmedCsv(result, start, end, resampleGyro) {
    const { t, ax, ay, az, tg, gx, gy, gz } = result;
    const tZero = t[start];
    const accelRows = ["timestamp,ax,ay,az"];
    for (let i = start; i < end; i++) {
        accelRows.push(
            `${(t[i] - tZero).toFixed(6)},${ax[i].toFixed(6)},${ay[i].toFixed(6)},${az[i].toFixed(6)}`,
        );
    }

    let gyroRows = null;
    if (gx) {
        gyroRows = ["timestamp,gx,gy,gz"];
        if (resampleGyro) {
            const target = t.subarray(start, end);
            const rx = resampleSignal(tg, gx, target);
            const ry = resampleSignal(tg, gy, target);
            const rz = resampleSignal(tg, gz, target);
            for (let i = 0; i < target.length; i++) {
                gyroRows.push(
                    `${(target[i] - tZero).toFixed(6)},${rx[i].toFixed(6)},${ry[i].toFixed(6)},${rz[i].toFixed(6)}`,
                );
            }
        } else {
            const from = lowerBound(tg, t[start]);
            const to = upperBound(tg, t[end - 1]);
            for (let i = from; i < to; i++) {
                gyroRows.push(
                    `${(tg[i] - tZero).toFixed(6)},${gx[i].toFixed(6)},${gy[i].toFixed(6)},${gz[i].toFixed(6)}`,
                );
            }
        }
    }

    return {
        accel: `${accelRows.join("\n")}\n`,
        gyro: gyroRows && gyroRows.length > 1 ? `${gyroRows.join("\n")}\n` : null,
        duration: t[end - 1] - t[start],
    };
}