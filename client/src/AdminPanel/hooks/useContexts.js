import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createContext,
  fetchContexts,
  fetchDeletedContexts,
  removeContext,
  restoreContext,
  updateContext,
} from "../../api";
import { IDLE, errorMessage, normalizeContext, sortContextsByName } from "../utils";

const fail = (setStatus, message) => {
  setStatus({ type: "error", message });
  return false;
};

export default function useContexts({ onChanged } = {}) {
  const [active, setActive] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(IDLE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contexts, removed] = await Promise.all([fetchContexts(), fetchDeletedContexts()]);
      setActive(Array.isArray(contexts) ? sortContextsByName(contexts) : []);
      setDeleted(Array.isArray(removed) ? sortContextsByName(removed) : []);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to load contexts.") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeNames = useMemo(() => active.map((c) => c.name), [active]);
  const deletedNames = useMemo(() => deleted.map((c) => c.name), [deleted]);

  const add = async (rawName) => {
    const name = normalizeContext(rawName);
    if (!name) return fail(setStatus, "Enter a context name.");
    if (activeNames.includes(name)) return fail(setStatus, "Context already exists.");
    if (deletedNames.includes(name))
      return fail(setStatus, "A deleted context with this name exists. Restore it instead.");
    try {
      const response = await createContext(name);
      const created = response?.context;
      if (created) setActive((cur) => sortContextsByName([...cur, created]));
      setStatus({ type: "success", message: `Context '${created?.name || name}' added.` });
      return true;
    } catch (error) {
      return fail(setStatus, errorMessage(error, "Failed to create context."));
    }
  };

  const rename = async (context, rawName) => {
    const name = normalizeContext(rawName);
    if (!name) return fail(setStatus, "Context name cannot be empty.");
    if (name === context.name) return true;
    if (activeNames.includes(name)) return fail(setStatus, "Another context uses this name.");
    if (deletedNames.includes(name)) return fail(setStatus, "A deleted context uses this name.");
    try {
      const response = await updateContext(context.name, name);
      const updated = response?.context || { ...context, name };
      setActive((cur) =>
        sortContextsByName(cur.map((c) => (c.id === updated.id ? updated : c))),
      );
      await onChanged?.();
      setStatus({ type: "success", message: `Renamed '${context.name}' to '${updated.name}'.` });
      return true;
    } catch (error) {
      return fail(setStatus, errorMessage(error, "Failed to rename context."));
    }
  };

  const remove = async (context) => {
    try {
      await removeContext(context.name);
      setActive((cur) => cur.filter((c) => c.id !== context.id));
      setDeleted((cur) => sortContextsByName([...cur, context]));
      await onChanged?.();
      setStatus({ type: "success", message: `Context '${context.name}' removed.` });
    } catch (error) {
      fail(setStatus, errorMessage(error, "Failed to remove context."));
    }
  };

  const restore = async (context) => {
    try {
      await restoreContext(context.name);
      setDeleted((cur) => cur.filter((c) => c.id !== context.id));
      setActive((cur) => sortContextsByName([...cur, context]));
      setStatus({ type: "success", message: `Context '${context.name}' restored.` });
    } catch (error) {
      fail(setStatus, errorMessage(error, "Failed to restore context."));
    }
  };

  return { active, deleted, loading, status, setStatus, reload: load, add, rename, remove, restore };
}
