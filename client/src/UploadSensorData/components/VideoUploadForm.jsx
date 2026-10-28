import { useState } from "react";
import { uploadRunVideo } from "../../api";
import FileDropzone from "../FileDropzone.jsx";
import RunSelect from "../RunSelect.jsx";
import StatusMessage from "../StatusMessage.jsx";

const IDLE = { type: "idle", message: "" };

const VideoUploadForm = ({ runs }) => {
  const [runId, setRunId] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(IDLE);
  const [isUploading, setIsUploading] = useState(false);

  const handleFile = (next) => {
    setStatus(IDLE);
    if (!next) return setFile(null);
    if (!next.name.toLowerCase().endsWith(".mp4")) {
      setFile(null);
      return setStatus({ type: "error", message: "Choose an .MP4 video file." });
    }
    setFile(next);
  };

  const reset = () => {
    setFile(null);
    setRunId("");
    setStatus(IDLE);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!runId.trim()) {
      return setStatus({ type: "error", message: "Select a run before uploading a video." });
    }
    if (!file) {
      return setStatus({ type: "error", message: "Choose an .MP4 file before uploading." });
    }

    setIsUploading(true);
    setStatus({ type: "info", message: "Uploading video…" });
    try {
      await uploadRunVideo(file, runId.trim());
      reset();
      setStatus({ type: "success", message: "Video uploaded and linked to the run." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Video upload failed. Try again.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form className="us-form" onSubmit={handleSubmit}>
      <p className="us-muted">
        Attach an .mp4 to an existing run. The video is stored in the server workspace and served from there.
      </p>

      <fieldset className="us-group" disabled={isUploading}>
        <legend className="us-legend">Run</legend>
        <div className="us-field">
          <label className="us-label" htmlFor="us-video-run">Run</label>
          <RunSelect id="us-video-run" runs={runs} value={runId} onChange={setRunId} />
        </div>
      </fieldset>

      <fieldset className="us-group" disabled={isUploading}>
        <legend className="us-legend">Video file</legend>
        <FileDropzone
          id="us-video-file"
          accept="video/mp4,.mp4"
          file={file}
          onFile={handleFile}
          disabled={isUploading}
          prompt="Choose a video or drop it here"
          formats=".MP4"
        />
      </fieldset>

      <StatusMessage status={status} />

      <div className="us-actions">
        <button
          className="us-btn us-btn--primary"
          type="submit"
          disabled={!file || !runId.trim() || isUploading}
        >
          {isUploading ? "Uploading…" : "Upload video"}
        </button>
        <button className="us-btn us-btn--ghost" type="button" onClick={reset} disabled={isUploading}>
          Clear form
        </button>
      </div>
    </form>
  );
};

export default VideoUploadForm;
