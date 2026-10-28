const RunSelect = ({ id, runs, value, onChange, disabled }) => (
  <select
    id={id}
    className="form-select"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
  >
    <option value="">Select a run</option>
    {runs.map((run) => (
      <option key={run._id} value={run._id}>
        {run.name || `Run ${run._id}`}
        {run.context ? ` (${run.context})` : ""}
      </option>
    ))}
  </select>
);

export default RunSelect;
