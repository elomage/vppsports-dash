import { useMemo, useState } from "react";
import { deleteRun, exportMultiRunCsv } from "../../api";
import MultiRunExport from "../../MultiRunExport";
import Card from "../components/Card";
import ConfirmButton from "../components/ConfirmButton";
import StatusMessage from "../components/StatusMessage";
import { IDLE, errorMessage } from "../utils";

const RunsSection = ({ runs, onRunDeleted }) => {
  const [selectedRunId, setSelectedRunId] = useState("");
  const [status, setStatus] = useState(IDLE);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const sortedRuns = useMemo(
    () =>
      [...(Array.isArray(runs) ? runs : [])].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      ),
    [runs],
  );

  const busy = isDeleting || isExporting;

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
        description="Pick a run to export its readings or delete it permanently."
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
