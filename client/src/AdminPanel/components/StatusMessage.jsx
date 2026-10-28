const StatusMessage = ({ status }) => {
  if (!status?.message) return null;
  return (
    <div className={`ap-status is-${status.type}`} role={status.type === "error" ? "alert" : "status"}>
      {status.message}
    </div>
  );
};

export default StatusMessage;
