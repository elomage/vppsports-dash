export function findPeaks(x, { height = -Infinity, distance = 1, prominence = 0 } = {}) {
    const n = x.length;
    let peaks = [];
    let i = 1;
    const iMax = n - 1;
    while (i < iMax) {
        if (x[i - 1] < x[i]) {
            let ahead = i + 1;
            while (ahead < iMax && x[ahead] === x[i]) ahead++;
            if (x[ahead] < x[i]) {
                peaks.push((i + ahead - 1) >> 1);
                i = ahead;
            }
        }
        i++;
    }

    peaks = peaks.filter((p) => x[p] >= height);

    const dist = Math.ceil(distance);
    if (dist > 1 && peaks.length > 1) {
        const keep = new Array(peaks.length).fill(true);
        const order = peaks.map((_, k) => k).sort((a, b) => x[peaks[a]] - x[peaks[b]]);
        for (let o = order.length - 1; o >= 0; o--) {
            const j = order[o];
            if (!keep[j]) continue;
            let k = j - 1;
            while (k >= 0 && peaks[j] - peaks[k] < dist) {
                keep[k] = false;
                k--;
            }
            k = j + 1;
            while (k < peaks.length && peaks[k] - peaks[j] < dist) {
                keep[k] = false;
                k++;
            }
        }
        peaks = peaks.filter((_, k) => keep[k]);
    }

    return peaks.filter((p) => {
        let leftMin = x[p];
        for (let k = p - 1; k >= 0 && x[k] <= x[p]; k--) if (x[k] < leftMin) leftMin = x[k];
        let rightMin = x[p];
        for (let k = p + 1; k < n && x[k] <= x[p]; k++) if (x[k] < rightMin) rightMin = x[k];
        return x[p] - Math.max(leftMin, rightMin) >= prominence;
    });
}
