import { useEffect, useState } from "react";

/** Two-step button: first click arms it, second click confirms. Disarms after 4s. */
const ConfirmButton = ({
  label = "Remove",
  confirmLabel = "Confirm",
  onConfirm,
  disabled = false,
  variant = "danger-ghost",
  size = "sm",
}) => {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        className={`ap-btn ap-btn--${variant} ap-btn--${size}`}
        onClick={() => setArmed(true)}
        disabled={disabled}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="ap-confirm">
      <button
        type="button"
        className={`ap-btn ap-btn--danger ap-btn--${size}`}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        className={`ap-btn ap-btn--ghost ap-btn--${size}`}
        onClick={() => setArmed(false)}
      >
        Cancel
      </button>
    </span>
  );
};

export default ConfirmButton;
