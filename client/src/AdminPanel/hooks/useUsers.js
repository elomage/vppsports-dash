import { useCallback, useEffect, useState } from "react";
import {
  createUser,
  fetchDeletedUsers,
  fetchUsers,
  removeUser,
  restoreUser,
  updateUser,
} from "../../api";
import { IDLE, errorMessage } from "../utils";

export default function useUsers({ onUserCreated } = {}) {
  const [active, setActive] = useState([]);
  const [deleted, setDeleted] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(IDLE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [activeUsers, removedUsers] = await Promise.all([fetchUsers(), fetchDeletedUsers()]);
      setActive(Array.isArray(activeUsers) ? activeUsers : []);
      setDeleted(Array.isArray(removedUsers) ? removedUsers : []);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to load users.") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Returns true on success so the form can reset itself. */
  const save = async (editingUsername, payload) => {
    if (saving) return false;
    const isEditing = Boolean(editingUsername);
    setSaving(true);
    setStatus({ type: "info", message: isEditing ? "Updating user…" : "Creating user…" });
    try {
      const response = isEditing
        ? await updateUser(editingUsername, payload)
        : await createUser(payload);
      setStatus({
        type: "success",
        message: isEditing
          ? `User '${payload.username}' updated.`
          : `User '${payload.username}' created.`,
      });
      await load();
      onUserCreated?.(response?.user);
      return true;
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to save user.") });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (username) => {
    try {
      await removeUser(username);
      await load();
      setStatus({ type: "success", message: `User '${username}' removed.` });
      return true;
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to remove user.") });
      return false;
    }
  };

  const restore = async (username) => {
    try {
      await restoreUser(username);
      await load();
      setStatus({ type: "success", message: `User '${username}' restored.` });
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to restore user.") });
    }
  };

  return { active, deleted, loading, saving, status, setStatus, reload: load, save, remove, restore };
}
