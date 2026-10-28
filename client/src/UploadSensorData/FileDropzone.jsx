import { useEffect, useRef, useState } from "react";

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Click-or-drop file picker. The parent validates the file in `onFile`
 * and passes the accepted file (or null) back through `file`.
 */
const FileDropzone = ({ id, accept, file, onFile, disabled, prompt, formats }) => {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Clear the native input whenever the parent drops the file (reset / invalid type).
  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = "";
  }, [file]);

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    onFile(event.dataTransfer.files?.[0] || null);
  };

  return (
    <label
      htmlFor={id}
      className={`us-drop ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""} ${disabled ? "is-disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        id={id}
        ref={inputRef}
        className="us-drop-input"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      {file ? (
        <span className="us-drop-file">
          <span className="us-drop-name">{file.name}</span>
          <span className="us-drop-meta">{formatSize(file.size)} · click or drop to replace</span>
        </span>
      ) : (
        <span className="us-drop-file">
          <span className="us-drop-name">{prompt}</span>
          <span className="us-drop-meta">{formats}</span>
        </span>
      )}
    </label>
  );
};

export default FileDropzone;
