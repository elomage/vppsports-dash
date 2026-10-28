import { useMemo, useState } from "react";
import { uploadSensorDataBin, uploadSensorDataCsv } from "../../api";
import FileDropzone from "../FileDropzone.jsx";
import RunSelect from "../RunSelect.jsx";
import StatusMessage from "../StatusMessage.jsx";

const IDLE = { type: "idle", message: "" };

const SENSOR_TYPES = [
  { value: "accelerometer", label: "Accelerometer" },
  { value: "gyroscope", label: "Gyroscope" },
  { value: "strainGauge", label: "Strain gauge" },
  { value: "gps", label: "GPS" },
];

const METADATA_PLACEHOLDER = `{
  "discipline": "luge",
  "athlete": "Name",
  "track": "Track",
  "weather": {
    "airTempC": -3
  }
}`;

const SensorDataForm = ({ currentUser, runs, onRunCreated }) => {
  const [mode, setMode] = useState("existing");
  const [existingRunId, setExistingRunId] = useState("");
  const [runName, setRunName] = useState("");
  const [contextId, setContextId] = useState("");
  const [sensorType, setSensorType] = useState("accelerometer");
  const [sensorName, setSensorName] = useState("");
  const [metadataJson, setMetadataJson] = useState("");
  const [file, setFile] = useState(null);
  const [fileType, setFileType] = useState("");
  const [status, setStatus] = useState(IDLE);
  const [isUploading, setIsUploading] = useState(false);

  const contexts = useMemo(
    () =>
      Array.isArray(currentUser?.contexts)
        ? currentUser.contexts.filter((c) => c?.id && c?.name)
        : [],
    [currentUser],
  );

  const extension = fileType === "csv" ? ".CSV" : ".BIN";

  const canSubmit =
    Boolean(file) &&
    !isUploading &&
    (mode === "existing" ? Boolean(existingRunId.trim()) : Boolean(runName.trim() && contextId.trim()));

  const handleFile = (next) => {
    setStatus(IDLE);
    if (!next) {
      setFile(null);
      setFileType("");
      return;
    }
    const name = next.name.toLowerCase();
    const type = name.endsWith(".csv") ? "csv" : name.endsWith(".bin") ? "bin" : "";
    if (!type) {
      setFile(null);
      setFileType("");
      setStatus({ type: "error", message: "Choose a .BIN or .CSV file." });
      return;
    }
    setFile(next);
    setFileType(type);
  };

  const reset = () => {
    setFile(null);
    setFileType("");
    setRunName("");
    setExistingRunId("");
    setContextId("");
    setMetadataJson("");
    setSensorName("");
    setStatus(IDLE);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const fail = (message) => setStatus({ type: "error", message });

    if (!file) return fail("Choose a .BIN or .CSV file before uploading.");
    const trimmedRunId = existingRunId.trim();
    const trimmedName = runName.trim();
    const trimmedMeta = metadataJson.trim();

    if (mode === "existing" && !trimmedRunId) return fail("Select a run before uploading.");
    if (mode === "new" && !trimmedName) return fail("Enter a run name before uploading.");
    if (mode === "new" && !contextId.trim()) return fail("Choose a context before uploading.");
    if (trimmedMeta) {
      try {
        const parsed = JSON.parse(trimmedMeta);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          return fail("Metadata must be a JSON object, for example { \"athlete\": \"Name\" }.");
        }
      } catch (error) {
        return fail(error instanceof Error ? `Metadata JSON is invalid: ${error.message}` : "Metadata JSON is invalid.");
      }
    }

    setIsUploading(true);
    setStatus({ type: "info", message: "Uploading file…" });
    try {
      const options =
        mode === "existing"
          ? { runId: trimmedRunId, sensorType, sensorName: sensorName.trim(), metadata: trimmedMeta }
          : {
              name: trimmedName,
              sensorType,
              sensorName: sensorName.trim(),
              contextId: contextId.trim(),
              metadata: trimmedMeta,
            };
      const response =
        fileType === "csv"
          ? await uploadSensorDataCsv(file, options)
          : await uploadSensorDataBin(file, options);

      const message =
        mode === "existing"
          ? `Upload complete. ${extension} sensor data was added to the run.`
          : `Upload complete. New run created with ${extension} data.`;
      reset();
      setStatus({ type: "success", message });
      if (response?.createdRun) onRunCreated?.(response);
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Upload failed. Try again.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form className="us-form" onSubmit={handleSubmit}>
      <fieldset className="us-group" disabled={isUploading}>
        <legend className="us-legend">Destination</legend>

        <div className="us-segmented" role="group" aria-label="Upload destination">
          <button
            type="button"
            className={mode === "existing" ? "is-on" : ""}
            aria-pressed={mode === "existing"}
            onClick={() => {
              setMode("existing");
              setStatus(IDLE);
            }}
          >
            Add to existing run
          </button>
          <button
            type="button"
            className={mode === "new" ? "is-on" : ""}
            aria-pressed={mode === "new"}
            onClick={() => {
              setMode("new");
              setStatus(IDLE);
            }}
          >
            Create new run
          </button>
        </div>

        {mode === "existing" ? (
          <div className="us-field">
            <label className="us-label" htmlFor="us-existing-run">Run</label>
            <RunSelect id="us-existing-run" runs={runs} value={existingRunId} onChange={setExistingRunId} />
          </div>
        ) : (
          <>
            <div className="us-field">
              <label className="us-label" htmlFor="us-run-name">Run name</label>
              <input
                id="us-run-name"
                className="form-control"
                type="text"
                value={runName}
                maxLength={120}
                onChange={(e) => setRunName(e.target.value)}
              />
            </div>
            <div className="us-field" role="radiogroup" aria-label="Context">
              <span className="us-label">Context</span>
              {contexts.length === 0 ? (
                <p className="us-muted">No contexts are assigned to your account. Ask an admin to add one.</p>
              ) : (
                <div className="us-chips">
                  {contexts.map((c) => (
                    <label key={c.id} className={`us-chip ${contextId === c.id ? "is-on" : ""}`}>
                      <input
                        type="radio"
                        name="us-context"
                        checked={contextId === c.id}
                        onChange={() => setContextId(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="us-group" disabled={isUploading}>
        <legend className="us-legend">Sensor</legend>
        <div className="us-grid">
          <div className="us-field">
            <label className="us-label" htmlFor="us-sensor-type">Type</label>
            <select
              id="us-sensor-type"
              className="form-select"
              value={sensorType}
              onChange={(e) => setSensorType(e.target.value)}
            >
              {SENSOR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="us-field">
            <label className="us-label" htmlFor="us-sensor-name">
              Name <span className="us-optional">optional</span>
            </label>
            <input
              id="us-sensor-name"
              className="form-control"
              type="text"
              value={sensorName}
              maxLength={80}
              placeholder="front, rear, left arm"
              onChange={(e) => setSensorName(e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="us-group" disabled={isUploading}>
        <legend className="us-legend">Data file</legend>
        <FileDropzone
          id="us-data-file"
          accept=".bin,.csv,text/csv"
          file={file}
          onFile={handleFile}
          disabled={isUploading}
          prompt="Choose a file or drop it here"
          formats=".BIN or .CSV"
        />
        {fileType === "csv" && (
          <div className="us-help">
            <p>
              Required: a <code>timestamp</code> column in seconds (<code>timestamp_ms</code> and{" "}
              <code>timestamp_us</code> also work). Every other column is imported as a data channel, for example{" "}
              <code>timestamp,x,y,z</code>.
            </p>
            <p>
              Optional: a <code>segment</code> column with annotation text. Consecutive rows with the same value
              become a range label, and a single row becomes a point label.
            </p>
          </div>
        )}
      </fieldset>

      <details className="us-details">
        <summary>Run metadata (optional)</summary>
        <textarea
          className="form-control us-mono"
          rows={8}
          value={metadataJson}
          onChange={(e) => setMetadataJson(e.target.value)}
          placeholder={METADATA_PLACEHOLDER}
          disabled={isUploading}
          aria-label="Run metadata JSON"
          spellCheck={false}
        />
      </details>

      <StatusMessage status={status} />

      <div className="us-actions">
        <button className="us-btn us-btn--primary" type="submit" disabled={!canSubmit}>
          {isUploading ? "Uploading…" : "Upload data"}
        </button>
        <button className="us-btn us-btn--ghost" type="button" onClick={reset} disabled={isUploading}>
          Clear form
        </button>
      </div>
    </form>
  );
};

export default SensorDataForm;
