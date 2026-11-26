import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteRun, deleteRunSensor, exportMultiRunCsv, fetchRunSensors } from "../../api";
import MultiRunExport from "../../export/MultiRunExport";
import Card from "../components/Card";
import ConfirmButton from "../components/ConfirmButton";
import StatusMessage from "../components/StatusMessage";
import { IDLE, errorMessage } from "../utils";

const IDLE_SENSORS = { status: "idle", message: "" };

const sensorLabel = (sensor) => {
  const type = String(sensor.sensorType || "").trim();
  const name = String(sensor.name || "").trim();
  if (type && name) return `${type} - ${name}`;
  if (type) return type;
  if (name) return name;
  return `Sensor ${sensor.sensorId}`;
};

const RunsSection = ({ runs, onRunDeleted }) => {
  const [selectedRunId, setSelectedRunId] = useState("");
  const [status, setStatus] = useState(IDLE);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sensors, setSensors] = useState([]);
  const [sensorsState, setSensorsState] = useState(IDLE_SENSORS);
  const [deletingSensorId, setDeletingSensorId] = useState(null);
  const requestRef = useRef(0);

  const sortedRuns = useMemo(
      () =>
          [...(Array.isArray(runs) ? runs : [])].sort((a, b) =>
              String(a.name || "").localeCompare(String(b.name || "")),
          ),
      [runs],
  );

  const busy = isDeleting || isExporting || deletingSensorId !== null;

  const loadSensors = useCallback(async (runId) => {
    const requestId = ++requestRef.current;
    if (!runId) {
      setSensors([]);
      setSensorsState(IDLE_SENSORS);
      return [];
    }
    setSensorsState({ status: "loading", message: "Loading sensors…" });
    try {
      const list = await fetchRunSensors(runId);
      const safe = Array.isArray(list) ? list : [];
      if (requestId === requestRef.current) {
        setSensors(safe);
        setSensorsState(IDLE_SENSORS);
      }
      return safe;
    } catch (error) {
      if (requestId === requestRef.current) {
        setSensors([]);
        setSensorsState({
          status: "error",
          message: errorMessage(error, "Could not load the sensors."),
        });
      }
      return [];
    }
  }, []);

  useEffect(() => {
    loadSensors(selectedRunId);
  }, [selectedRunId, loadSensors]);

  const handleDelete = async () => {
    if (!selectedRunId || busy) return;
    setIsDeleting(true);
    setStatus({ type: "info", message: "Deleting run…" });
    try {
      await deleteRun(selectedRunId);
      setStatus({ type: "success", message: "Run and its sensor readings deleted." });
      const deletedId = selectedRunId;
      setSelectedRunId("");
      onRunDeleted?.(deletedId);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to delete run.") });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSensor = async (sensor) => {
    if (!selectedRunId || busy) return;
    setDeletingSensorId(sensor.sensorId);
    setStatus({ type: "info", message: "Deleting sensor data…" });
    try {
      await deleteRunSensor(selectedRunId, sensor.sensorId);
      const remaining = await loadSensors(selectedRunId);
      setStatus({
        type: "success",
        message:
            remaining.length === 0
                ? `${sensorLabel(sensor)} data deleted. This run has no sensor data left.`
                : `${sensorLabel(sensor)} data deleted.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: errorMessage(error, "Failed to delete sensor data."),
      });
    } finally {
      setDeletingSensorId(null);
    }
  };

  const handleExportCsv = async () => {
    if (!selectedRunId || busy) return;
    setIsExporting(true);
    setStatus({ type: "info", message: "Preparing CSV export…" });
    try {
      const { blob, fileName } = await exportMultiRunCsv([selectedRunId]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setStatus({ type: "success", message: "CSV downloaded." });
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to export run.") });
    } finally {
      setIsExporting(false);
    }
  };

  return (
      <div className="ap-stack">
        <Card
            title="Single run"
            description="Pick a run to export its readings, delete the data of one sensor, or delete the whole run."
        >
          <label className="ap-label" htmlFor="admin-run">
            Run
          </label>
          <select
              id="admin-run"
              className="form-select"
              value={selectedRunId}
              onChange={(e) => {
                setSelectedRunId(e.target.value);
                setStatus(IDLE);
              }}
              disabled={busy}
          >
            <option value="">Select a run</option>
            {sortedRuns.map((run) => (
                <option key={run._id} value={run._id}>
                  {run.name || `Run ${run._id}`}
                  {run.context ? ` (${run.context})` : ""}
                </option>
            ))}
          </select>

          {selectedRunId && (
              <div>
                <span className="ap-label">Sensor data</span>
                {sensorsState.message && (
                    <p className={`ap-note ${sensorsState.status === "error" ? "is-error" : ""}`}>
                      {sensorsState.message}
                    </p>
                )}
                {sensorsState.status === "idle" && sensors.length === 0 && (
                    <div className="ap-empty">This run has no sensor data.</div>
                )}
                {sensors.length > 0 && (
                    <ul className="ap-list">
                      {sensors.map((sensor) => (
                          <li key={sensor.sensorId} className="ap-list-row">
                            <div>
                              <div className="ap-list-name">{sensorLabel(sensor)}</div>
                              <span className="ap-badge">ID {sensor.sensorId}</span>
                            </div>
                            <ConfirmButton
                                label={deletingSensorId === sensor.sensorId ? "Deleting…" : "Delete data"}
                                confirmLabel="Delete sensor data"
                                variant="danger-ghost"
                                size="sm"
                                onConfirm={() => handleDeleteSensor(sensor)}
                                disabled={busy}
                            />
                          </li>
                      ))}
                    </ul>
                )}
              </div>
          )}

          <div className="ap-row ap-row--end">
            <button
                type="button"
                className="ap-btn ap-btn--secondary"
                onClick={handleExportCsv}
                disabled={!selectedRunId || busy}
            >
              {isExporting ? "Exporting…" : "Export CSV"}
            </button>
            <ConfirmButton
                label="Delete run"
                confirmLabel="Delete run and readings"
                variant="danger-ghost"
                size="md"
                onConfirm={handleDelete}
                disabled={!selectedRunId || busy}
            />
          </div>
          <StatusMessage status={status} />
        </Card>

        <div className="ap-embed">
          <MultiRunExport runs={sortedRuns} />
        </div>
      </div>
  );
};

export default RunsSection;