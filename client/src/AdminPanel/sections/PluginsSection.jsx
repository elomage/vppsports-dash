import { useCallback, useEffect, useState } from "react";
import {
  fetchPluginAssignments,
  resetPluginAssignments,
  updatePluginAssignments,
} from "../../api";
import Card from "../components/Card";
import ConfirmButton from "../components/ConfirmButton";
import EmptyState from "../components/EmptyState";
import StatusMessage from "../components/StatusMessage";
import { IDLE, errorMessage } from "../utils";

const TYPES = [
  { id: "visualization", label: "Visualizations" },
  { id: "filter", label: "Filters" },
];

const PluginsSection = ({ contexts }) => {
  const [contextId, setContextId] = useState("");
  const [type, setType] = useState("visualization");
  const [plugins, setPlugins] = useState([]);
  const [hasContextConfig, setHasContextConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(IDLE);

  const load = useCallback(async () => {
    setIsLoading(true);
    setStatus(IDLE);
    try {
      const data = await fetchPluginAssignments(contextId || null, type);
      setPlugins(Array.isArray(data?.plugins) ? data.plugins : []);
      setHasContextConfig(Boolean(data?.hasContextConfig));
      setDirty(false);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to load plugins.") });
    } finally {
      setIsLoading(false);
    }
  }, [contextId, type]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) => {
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
    setDirty(true);
  };

  const move = (id, direction) => {
    setPlugins((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const swap = idx + direction;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setStatus({ type: "info", message: "Saving…" });
    try {
      await updatePluginAssignments(
        contextId || null,
        type,
        plugins.map((p, order) => ({ pluginId: p.id, enabled: p.enabled, order })),
      );
      setStatus({ type: "success", message: "Plugin assignments saved." });
      setHasContextConfig(true);
      setDirty(false);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to save plugins.") });
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async () => {
    if (!contextId) return;
    try {
      await resetPluginAssignments(contextId, type);
      await load();
      setStatus({ type: "success", message: "Reset to global defaults." });
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to reset.") });
    }
  };

  return (
    <Card
      title="Plugin assignments"
      description="Choose which plugins are available and in what order. Global defaults apply to any context without its own config."
    >
      <div className="ap-toolbar">
        <div className="ap-toolbar-field">
          <label className="ap-label" htmlFor="plugin-context">Context</label>
          <select
            id="plugin-context"
            className="form-select"
            value={contextId}
            onChange={(e) => setContextId(e.target.value)}
            disabled={isSaving}
          >
            <option value="">Global defaults</option>
            {contexts.active.map((ctx) => (
              <option key={ctx.id} value={ctx.id}>{ctx.name}</option>
            ))}
          </select>
        </div>

        <div className="ap-segmented" role="group" aria-label="Plugin type">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={type === t.id ? "is-on" : ""}
              aria-pressed={type === t.id}
              onClick={() => setType(t.id)}
              disabled={isSaving}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {contextId && (
        <p className="ap-note">
          {hasContextConfig
            ? "This context has its own config."
            : "This context uses global defaults. Saving creates its own config."}
        </p>
      )}

      {isLoading ? (
        <EmptyState>Loading plugins…</EmptyState>
      ) : plugins.length === 0 ? (
        <EmptyState>No plugins of this type.</EmptyState>
      ) : (
        <ol className="ap-plugins">
          {plugins.map((plugin, idx) => (
            <li key={plugin.id} className={`ap-plugin ${plugin.enabled ? "" : "is-off"}`}>
              <div className="ap-plugin-order">
                <button
                  type="button"
                  className="ap-icon-btn"
                  onClick={() => move(plugin.id, -1)}
                  disabled={idx === 0 || isSaving}
                  aria-label={`Move ${plugin.label || plugin.id} up`}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="ap-icon-btn"
                  onClick={() => move(plugin.id, 1)}
                  disabled={idx === plugins.length - 1 || isSaving}
                  aria-label={`Move ${plugin.label || plugin.id} down`}
                >
                  ▼
                </button>
              </div>
              <div className="ap-plugin-info">
                <span className="ap-strong">{plugin.label || plugin.id}</span>
                <code>{plugin.id}</code>
              </div>
              <span className={`ap-badge ${plugin.builtin ? "" : "ap-badge--accent"}`}>
                {plugin.builtin ? "Built-in" : "Custom"}
              </span>
              <div className="form-check form-switch m-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={plugin.enabled}
                  onChange={() => toggle(plugin.id)}
                  disabled={isSaving}
                  aria-label={`Enable ${plugin.label || plugin.id}`}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      <StatusMessage status={status} />

      <div className="ap-row ap-row--between">
        <button
          type="button"
          className="ap-btn ap-btn--primary"
          onClick={save}
          disabled={isSaving || plugins.length === 0 || !dirty}
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
        {contextId && hasContextConfig && (
          <ConfirmButton
            label="Reset to defaults"
            confirmLabel="Reset context config"
            variant="ghost"
            size="md"
            onConfirm={reset}
            disabled={isSaving}
          />
        )}
      </div>
    </Card>
  );
};

export default PluginsSection;
