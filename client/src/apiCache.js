const MAX_ENTRIES = 80;
const MAX_COMPUTED = 30;

const store = new Map();
const inflight = new Map();
const computed = new Map();

export function cached(key, ttlMs, loader) {
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) {
        store.delete(key);
        store.set(key, hit);
        return Promise.resolve(hit.value);
    }
    if (hit) store.delete(key);

    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
        try {
            const value = await loader();
            if (value !== null && value !== undefined) {
                store.set(key, { value, expires: Date.now() + ttlMs });
                while (store.size > MAX_ENTRIES) {
                    store.delete(store.keys().next().value);
                }
            }
            return value;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, promise);
    return promise;
}

export function memoCompute(key, compute) {
    if (computed.has(key)) {
        const value = computed.get(key);
        computed.delete(key);
        computed.set(key, value);
        return value;
    }
    const value = compute();
    computed.set(key, value);
    while (computed.size > MAX_COMPUTED) {
        computed.delete(computed.keys().next().value);
    }
    return value;
}

export function invalidateRun(runId) {
    const prefix = `run:${runId}:`;
    for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) store.delete(key);
    }
    for (const key of [...inflight.keys()]) {
        if (key.startsWith(prefix)) inflight.delete(key);
    }
    for (const key of [...computed.keys()]) {
        if (key.startsWith(prefix)) computed.delete(key);
    }
}

export function clearCache() {
    store.clear();
    inflight.clear();
    computed.clear();
}