import { useCallback, useEffect, useRef, useState } from "react";
import { deleteFilter, fetchFilters, uploadFilter } from "../../api";
import Card from "../components/Card";
import ConfirmButton from "../components/ConfirmButton";
import EmptyState from "../components/EmptyState";
import StatusMessage from "../components/StatusMessage";
import { IDLE, errorMessage } from "../utils";

const FILTER_TEMPLATE = `export default {
  id: "my-filter",
  label: "My filter",
  description: "What this filter does",
  params: [],
  apply: (readings, params) => readings,
};`;

const FiltersSection = () => {
  const [filters, setFilters] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [status, setStatus] = useState(IDLE);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchFilters();
      setFilters(Array.isArray(data) ? data : []);
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to load filters.") });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clearInput = () => {
    setPendingFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return setPendingFile(null);
    if (!file.name.endsWith(".js")) {
      setStatus({ type: "error", message: "Only .js files are allowed." });
      return clearInput();
    }
    setPendingFile(file);
    setStatus(IDLE);
  };

  const handleUpload = async () => {
    if (!pendingFile) return;
    setIsUploading(true);
    setStatus({ type: "info", message: `Uploading ${pendingFile.name}…` });
    try {
      const code = await pendingFile.text();
      const result = await uploadFilter(pendingFile.name, code);
      setStatus({
        type: "success",
        message: `Filter '${result?.filter?.label || pendingFile.name}' uploaded.`,
      });
      clearInput();
      await load();
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to upload filter.") });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (filter) => {
    try {
      await deleteFilter(filter.id);
      setStatus({ type: "success", message: `Filter '${filter.label}' deleted.` });
      await load();
    } catch (error) {
      setStatus({ type: "error", message: errorMessage(error, "Failed to delete filter.") });
    }
  };

  return (
    <div className="ap-stack">
      <Card
        title="Upload custom filter"
        description="Add a .js file that exports a filter definition."
      >
        <details className="ap-details">
          <summary>Expected file format</summary>
          <pre className="ap-code"><code>{FILTER_TEMPLATE}</code></pre>
        </details>

        <div className="ap-row">
          <input
            ref={inputRef}
            className="form-control"
            type="file"
            accept=".js"
            onChange={handleFileChange}
            disabled={isUploading}
            aria-label="Filter file"
          />
          <button
            type="button"
            className="ap-btn ap-btn--primary"
            onClick={handleUpload}
            disabled={!pendingFile || isUploading}
          >
            {isUploading ? "Uploading…" : "Upload filter"}
          </button>
        </div>
        <StatusMessage status={status} />
      </Card>

      <Card title={`Loaded filters (${filters.length})`}>
        {isLoading && !filters.length ? (
          <EmptyState>Loading filters…</EmptyState>
        ) : filters.length === 0 ? (
          <EmptyState>No filters loaded.</EmptyState>
        ) : (
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Label</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filters.map((filter) => (
                  <tr key={filter.id}>
                    <td><code>{filter.id}</code></td>
                    <td className="ap-strong">{filter.label}</td>
                    <td>
                      <span className={`ap-badge ${filter.builtin ? "" : "ap-badge--accent"}`}>
                        {filter.builtin ? "Built-in" : "Custom"}
                      </span>
                    </td>
                    <td className="ap-cell-actions">
                      {!filter.builtin && (
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Delete permanently"
                          onConfirm={() => handleDelete(filter)}
                          disabled={isUploading}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default FiltersSection;
