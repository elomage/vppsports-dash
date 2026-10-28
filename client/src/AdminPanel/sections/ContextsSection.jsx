import { useState } from "react";
import Card from "../components/Card";
import ConfirmButton from "../components/ConfirmButton";
import EmptyState from "../components/EmptyState";
import StatusMessage from "../components/StatusMessage";
import { IDLE } from "../utils";

const ContextRow = ({ context, onRename, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(context.name);

  const submit = async (event) => {
    event.preventDefault();
    if (await onRename(context, name)) setEditing(false);
  };

  return (
    <li className="ap-list-row">
      {editing ? (
        <form className="ap-inline-form" onSubmit={submit}>
          <input
            className="form-control form-control-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`New name for ${context.name}`}
            autoFocus
          />
          <button type="submit" className="ap-btn ap-btn--primary ap-btn--sm">
            Save
          </button>
          <button
            type="button"
            className="ap-btn ap-btn--ghost ap-btn--sm"
            onClick={() => {
              setEditing(false);
              setName(context.name);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="ap-list-name">{context.name}</span>
          <span className="ap-row-actions">
            <button
              type="button"
              className="ap-btn ap-btn--ghost ap-btn--sm"
              onClick={() => setEditing(true)}
            >
              Rename
            </button>
            <ConfirmButton onConfirm={() => onRemove(context)} />
          </span>
        </>
      )}
    </li>
  );
};

const ContextsSection = ({ contexts }) => {
  const [newName, setNewName] = useState("");
  const { active, deleted, loading, status, setStatus } = contexts;

  const handleAdd = async (event) => {
    event.preventDefault();
    if (await contexts.add(newName)) setNewName("");
  };

  return (
    <div className="ap-stack">
      <Card
        title="Add context"
        description="Contexts group runs and control which users and plugins apply."
      >
        <form className="ap-inline-form" onSubmit={handleAdd}>
          <input
            className="form-control"
            placeholder="Context name"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setStatus(IDLE);
            }}
            aria-label="Context name"
          />
          <button type="submit" className="ap-btn ap-btn--primary">
            Add context
          </button>
        </form>
        <StatusMessage status={status} />
      </Card>

      <Card title={`Available contexts (${active.length})`}>
        {loading && !active.length ? (
          <EmptyState>Loading contexts…</EmptyState>
        ) : active.length === 0 ? (
          <EmptyState>No contexts yet. Add one above to get started.</EmptyState>
        ) : (
          <ul className="ap-list">
            {active.map((context) => (
              <ContextRow
                key={context.id}
                context={context}
                onRename={contexts.rename}
                onRemove={contexts.remove}
              />
            ))}
          </ul>
        )}
      </Card>

      {deleted.length > 0 && (
        <Card title={`Deleted contexts (${deleted.length})`}>
          <ul className="ap-list">
            {deleted.map((context) => (
              <li key={context.id} className="ap-list-row">
                <span className="ap-list-name is-muted">{context.name}</span>
                <button
                  type="button"
                  className="ap-btn ap-btn--secondary ap-btn--sm"
                  onClick={() => contexts.restore(context)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

export default ContextsSection;
