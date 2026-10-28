const StatusMessage = ({ status }) => {
  if (!status?.message) return null;
  return (
    <div className={`us-status is-${status.type}`} role={status.type === "error" ? "alert" : "status"} aria-live="polite">
      {status.message}
    </div>
  );
};

export default StatusMessage;
