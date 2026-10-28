import { useMemo, useState } from "react";
import SensorDataForm from "./components/SensorDataForm";
import VideoUploadForm from "./components/VideoUploadForm";
import "./UploadSensorData.css";

const TABS = [
  { id: "sensor", label: "Sensor data", hint: "Add .BIN or .CSV readings to a new or existing run." },
  { id: "video", label: "Run video", hint: "Attach an .MP4 to an existing run." },
];

const UploadSensorData = ({ currentUser, runs, onRunCreated }) => {
  const [tab, setTab] = useState("sensor");
  const visibleRuns = useMemo(() => (Array.isArray(runs) ? runs : []), [runs]);
  const current = TABS.find((t) => t.id === tab);

  return (
    <div className="us-view">
      <div className="us-page">
        <header className="us-head">
          <h2>Upload</h2>
          <p>{current.hint}</p>
        </header>

        <div className="us-tabs" role="tablist" aria-label="Upload type">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`us-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`us-panel-${t.id}`}
              className={tab === t.id ? "is-on" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Both panels stay mounted so half-filled forms survive tab switches. */}
        <section
          id="us-panel-sensor"
          role="tabpanel"
          aria-labelledby="us-tab-sensor"
          className="us-card"
          hidden={tab !== "sensor"}
        >
          <SensorDataForm currentUser={currentUser} runs={visibleRuns} onRunCreated={onRunCreated} />
        </section>
        <section
          id="us-panel-video"
          role="tabpanel"
          aria-labelledby="us-tab-video"
          className="us-card"
          hidden={tab !== "video"}
        >
          <VideoUploadForm runs={visibleRuns} />
        </section>
      </div>
    </div>
  );
};

export default UploadSensorData;
