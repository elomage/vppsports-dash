import { cached, invalidateRun, clearCache } from "./apiCache";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;
const ACCESS_TOKEN_STORAGE_KEY = "vppsports_access_token";

const TTL = {
  run: 5 * 60 * 1000,
  sensors: 10 * 60 * 1000,
  raw: 10 * 60 * 1000,
  trims: 5 * 60 * 1000,
  metrics: 10 * 60 * 1000,
};

let accessToken = null;
let onAuthFailure = null;
let refreshInFlight = null;

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function setAuthFailureHandler(handler) {
  onAuthFailure = typeof handler === "function" ? handler : null;
}

export function setAccessToken(token) {
  accessToken = token || null;
  if (accessToken) {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  } else {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    clearCache();
  }
}

function notifyAuthFailure() {
  if (typeof onAuthFailure === "function") {
    onAuthFailure();
  }
}

async function parseResponse(response) {
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function refreshAccessToken() {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const response = await fetch(`${SERVER_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      setAccessToken(null);
      throw new UnauthorizedError("Session expired");
    }

    const data = await response.json();
    setAccessToken(data.accessToken);
    return data.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return request(path, options, false);
    } catch (error) {
      notifyAuthFailure();
      throw error;
    }
  }

  if (response.status === 401) {
    notifyAuthFailure();
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.error
                ? `${payload?.message || `Request failed (${response.status})`}: ${payload.error}`
                : payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return parseResponse(response);
}

export async function login(username, password) {
  const response = await fetch(`${SERVER_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.message || "Login failed";
    throw new Error(message);
  }

  const data = await response.json();
  setAccessToken(data.accessToken);
  return data;
}

export async function fetchCurrentUser() {
  const data = await request("/auth/me");
  return data?.user || null;
}

export async function initializeSession() {
  const cachedToken = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  if (cachedToken) {
    setAccessToken(cachedToken);
    try {
      return await fetchCurrentUser();
    } catch (error) {
      setAccessToken(null);
    }
  }

  try {
    await refreshAccessToken();
    return await fetchCurrentUser();
  } catch (error) {
    setAccessToken(null);
    return null;
  }
}

export async function logout() {
  try {
    await request("/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
  } finally {
    setAccessToken(null);
    notifyAuthFailure();
  }
}

export async function fetchRuns(dateFrom, dateTo) {
  return request(`/run?dateFrom=${dateFrom || ""}&dateTo=${dateTo || ""}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function fetchSelectedRun(runId) {
  return cached(`run:${runId}:run`, TTL.run, () => request(`/run/${runId}`));
}

export async function updateRunLabels(runId, labels) {
  const result = await request(`/run/${runId}/labels`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ labels }),
  });
  invalidateRun(runId);
  return result;
}

export async function fetchRunTrims(runId) {
  return cached(`run:${runId}:trims`, TTL.trims, () =>
      request(`/run/${runId}/trims`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }),
  );
}

export async function updateRunTrims(runId, trims) {
  const result = await request(`/run/${runId}/trims`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trims }),
  });
  invalidateRun(runId);
  return result;
}

export async function updateRunMetadata(runId, fields) {
  const result = await request(`/run/${runId}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  invalidateRun(runId);
  return result;
}

export async function fetchRunVideo(videoName, retry = true) {
  const headers = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${SERVER_URL}/video/${videoName}`, {
    headers,
    credentials: "include",
  });

  if (response.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return fetchRunVideo(videoName, false);
    } catch (error) {
      notifyAuthFailure();
      throw error;
    }
  }

  if (response.status === 401) {
    notifyAuthFailure();
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.message || "Failed to fetch video";
    throw new Error(message);
  }

  return response;
}

async function checkRunVideoExistsUncached(videoName, retry = true) {
  if (!videoName) return false;

  const headers = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${SERVER_URL}/video/${videoName}`, {
    method: "HEAD",
    headers,
    credentials: "include",
  });

  if (response.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return checkRunVideoExistsUncached(videoName, false);
    } catch (error) {
      notifyAuthFailure();
      throw error;
    }
  }

  if (response.status === 401) {
    notifyAuthFailure();
    throw new UnauthorizedError();
  }

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.message || "Failed to check video availability";
    throw new Error(message);
  }

  return true;
}

export function checkRunVideoExists(videoName) {
  if (!videoName) return Promise.resolve(false);
  return cached(`run:${videoName}:video-exists`, TTL.sensors, () =>
      checkRunVideoExistsUncached(videoName),
  );
}

export async function uploadSensorDataBin(file, options = {}) {
  return uploadSensorDataFile(file, {
    ...options,
    uploadFormat: "bin",
    contentType: "application/octet-stream",
  });
}

export async function uploadSensorDataCsv(file, options = {}) {
  return uploadSensorDataFile(file, {
    ...options,
    uploadFormat: "csv",
    contentType: "text/csv",
  });
}

async function uploadSensorDataFile(file, options = {}) {
  const params = new URLSearchParams();
  const { contentType, ...queryOptions } = options;
  Object.entries(queryOptions).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, value);
    }
  });

  const query = params.toString();
  const uploadUrl = `/run/upload${query ? `?${query}` : ""}`;

  const result = await request(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: await file.arrayBuffer(),
  });
  if (options.runId) invalidateRun(options.runId);
  return result;
}

export async function uploadRunVideo(file, runId) {
  const params = new URLSearchParams();
  if (runId) {
    params.append("runId", runId);
  }

  const query = params.toString();
  const uploadUrl = `/video/upload${query ? `?${query}` : ""}`;

  const result = await request(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: await file.arrayBuffer(),
  });
  if (runId) invalidateRun(runId);
  return result;
}

export async function deleteRun(runId) {
  const result = await request(`/run/${runId}`, {
    method: "DELETE",
  });
  invalidateRun(runId);
  return result;
}

export async function exportRunArff(runId, variant = "features", points) {
  const params = new URLSearchParams();
  if (variant) {
    params.append("variant", variant);
  }
  if (points !== undefined && points !== null && points !== "") {
    params.append("points", String(points));
  }

  const path = `/run/${runId}/export/arff${params.toString() ? `?${params.toString()}` : ""}`;
  const headers = new Headers();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${SERVER_URL}${path}`, {
    method: "GET",
    headers,
    credentials: "include",
  });

  if (response.status === 401) {
    notifyAuthFailure();
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.error
                ? `${payload?.message || `Request failed (${response.status})`}: ${payload.error}`
                : payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename=\"([^\"]+)\"/i);

  return {
    blob,
    fileName: fileNameMatch?.[1] || `run-${runId}-${variant}.arff`,
  };
}

export async function exportAprioriCsv(runIds, numBins) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${SERVER_URL}/run/export/apriori-csv`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ runIds, numBins }),
  });

  if (response.status === 401) {
    notifyAuthFailure();
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.error
                ? `${payload?.message || `Request failed (${response.status})`}: ${payload.error}`
                : payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return {
    blob,
    fileName: fileNameMatch?.[1] || `multi-run-apriori-${dateStamp}.csv`,
  };
}

export async function exportMultiRunCsv(runIds, fields) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${SERVER_URL}/run/export/multi-csv`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ runIds, fields }),
  });

  if (response.status === 401) {
    notifyAuthFailure();
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const message =
        typeof payload === "string"
            ? payload
            : payload?.error
                ? `${payload?.message || `Request failed (${response.status})`}: ${payload.error}`
                : payload?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
  const dateStamp = new Date().toISOString().slice(0, 10);

  return {
    blob,
    fileName: fileNameMatch?.[1] || `multi-run-${dateStamp}.csv`,
  };
}

export async function createUser(payload) {
  return request("/auth/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchUsers() {
  return request("/auth/users", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function fetchDeletedUsers() {
  return request("/auth/users/deleted", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function updateUser(currentUsername, payload) {
  return request(`/auth/users/${encodeURIComponent(currentUsername)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function removeUser(username) {
  return request(`/auth/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function restoreUser(username) {
  return request(`/auth/users/${encodeURIComponent(username)}/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

export async function fetchContexts() {
  return request("/context", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function fetchDeletedContexts() {
  return request("/context/deleted", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function createContext(name) {
  return request("/context", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
}

export async function updateContext(currentName, name) {
  return request(`/context/${encodeURIComponent(currentName)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
}

export async function removeContext(name) {
  return request(`/context/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function restoreContext(name) {
  return request(`/context/${encodeURIComponent(name)}/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

export async function fetchRunViewState(runId) {
  return request(`/run/${encodeURIComponent(runId)}/view-state`, { method: "GET" });
}

export async function saveRunViewState(runId, charts) {
  return request(`/run/${encodeURIComponent(runId)}/view-state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ charts }),
  });
}

export async function saveVideoSyncOffset(runId, videoSyncOffset) {
  return request(`/run/${encodeURIComponent(runId)}/view-state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoSyncOffset }),
  });
}

export async function fetchFilters() {
  return cached("global:filters", TTL.sensors, () => request("/filters", { method: "GET" }));
}

export async function uploadFilter(filename, code) {
  const result = await request("/filters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, code }),
  });
  clearCache();
  return result;
}

export async function deleteFilter(id) {
  const result = await request(`/filters/${encodeURIComponent(id)}`, { method: "DELETE" });
  clearCache();
  return result;
}

export async function fetchPluginAssignments(contextId, pluginType) {
  const params = new URLSearchParams({ pluginType });
  if (contextId) params.append("contextId", contextId);
  return request(`/plugins?${params.toString()}`, { method: "GET" });
}

export async function updatePluginAssignments(contextId, pluginType, assignments) {
  const params = new URLSearchParams({ pluginType });
  if (contextId) params.append("contextId", contextId);
  return request(`/plugins?${params.toString()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
}

export async function resetPluginAssignments(contextId, pluginType) {
  const params = new URLSearchParams({ pluginType });
  if (contextId) params.append("contextId", contextId);
  return request(`/plugins?${params.toString()}`, { method: "DELETE" });
}

export async function fetchRideMetrics(runId) {
  return cached(`run:${runId}:metrics`, TTL.metrics, async () => {
    try {
      return await request(`/run/${encodeURIComponent(runId)}/ride-metrics`, { method: "GET" });
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      if (/\b404\b|not found/i.test(error.message)) return null;
      throw error;
    }
  });
}

export async function fetchRunSensors(runId) {
  return cached(`run:${runId}:sensors`, TTL.sensors, async () => {
    const sensors = await request(`/run/${encodeURIComponent(runId)}/sensor`, { method: "GET" });
    return Array.isArray(sensors) ? sensors : [];
  });
}

export async function fetchSensorRaw(runId, sensorId) {
  return cached(`run:${runId}:raw:${sensorId}`, TTL.raw, async () => {
    const data = await request(
        `/run/${encodeURIComponent(runId)}/sensor/${encodeURIComponent(sensorId)}/data?mode=raw`,
        { method: "GET" },
    );
    return Array.isArray(data?.readings) ? data.readings : [];
  });
}