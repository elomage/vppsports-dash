export const normalizeContext = (value) => String(value || "").trim().toLowerCase();
export const normalizeUsername = (value) => String(value || "").trim().toLowerCase();

export const sortContextsByName = (contexts) =>
  [...contexts].sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));

export const errorMessage = (error, fallback) =>
  error instanceof Error ? error.message : fallback;

export const IDLE = { type: "idle", message: "" };
