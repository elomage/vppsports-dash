import React, { useState, useEffect, useRef } from 'react';
import { fetchRuns, fetchSelectedRun } from './api';
import './Runcontrol.css';

const NONE = 'null';

const RunControl = ({ setSelectedRun, runs: externalRuns }) => {
  const [runs, setRuns] = useState([]);
  const [dateFrom] = useState('');
  const [dateTo] = useState('');
  const [selectedId, setSelectedId] = useState(NONE);
  const [loadingRun, setLoadingRun] = useState(false);
  const committedIdRef = useRef(NONE);

  useEffect(() => {
    if (Array.isArray(externalRuns)) {
      setRuns(externalRuns);
      return;
    }

    fetchRuns(dateFrom, dateTo)
        .then(setRuns)
        .catch((err) => {
          console.error('Failed to fetch runs', err);
          setRuns([]);
        });
  }, [dateFrom, dateTo, externalRuns]);

  const handleRunChange = async (event) => {
    const runId = event.target.value;
    setSelectedId(runId);

    if (runId === NONE) {
      committedIdRef.current = NONE;
      setSelectedRun(null);
      return;
    }

    setLoadingRun(true);
    try {
      const runData = await fetchSelectedRun(runId);
      committedIdRef.current = runId;
      setSelectedRun(runData);
    } catch (err) {
      console.error('Failed to load run data', err);
      setSelectedId(committedIdRef.current);
    } finally {
      setLoadingRun(false);
    }
  };

  return (
      <div className="run-control-container">
        <label className="run-label" htmlFor="run-select">Ride</label>
        <select
            id="run-select"
            className="run-select"
            value={selectedId}
            onChange={handleRunChange}
            disabled={loadingRun}
        >
          <option value={NONE}>Select a ride</option>
          {runs.map((run) => (
              <option key={run._id} value={run._id}>
                {run.name || `Run ${run._id}`}
              </option>
          ))}
        </select>

        {loadingRun && (
            <div className="run-loading" role="status" aria-live="polite">
              <span className="run-spinner" aria-hidden="true" />
              Loading ride data…
            </div>
        )}
      </div>
  );
};

export default RunControl;