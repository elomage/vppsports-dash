import { useState } from "react";
import Card from "../components/Card";
import ConfirmButton from "../components/ConfirmButton";
import EmptyState from "../components/EmptyState";
import StatusMessage from "../components/StatusMessage";
import { normalizeUsername } from "../utils";

const emptyForm = () => ({ username: "", password: "", role: "user", contextIds: [] });

const ContextChips = ({ contexts }) =>
  Array.isArray(contexts) && contexts.length > 0 ? (
    <span className="ap-chips">
      {contexts.map((c) => (
        <span key={c.id || c.name} className="ap-chip">
          {c.name}
        </span>
      ))}
    </span>
  ) : (
    <span className="is-muted">None</span>
  );

const UsersSection = ({ users, contexts }) => {
  const [form, setForm] = useState(emptyForm);
  const [editingUsername, setEditingUsername] = useState("");
  const isEditing = Boolean(editingUsername);
  const { active, deleted, loading, saving, status, setStatus } = users;

  const reset = () => {
    setForm(emptyForm());
    setEditingUsername("");
  };

  const startEdit = (user) => {
    setEditingUsername(normalizeUsername(user.username));
    setForm({
      username: user.username || "",
      password: "",
      role: user.role || "user",
      contextIds: Array.isArray(user.contexts) ? user.contexts.map((c) => c.id).filter(Boolean) : [],
    });
    setStatus({ type: "info", message: `Editing '${user.username}'.` });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleContext = (id) =>
    setForm((cur) => ({
      ...cur,
      contextIds: cur.contextIds.includes(id)
        ? cur.contextIds.filter((x) => x !== id)
        : [...cur.contextIds, id],
    }));

  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      username: normalizeUsername(form.username),
      role: form.role,
      contextIds: form.contextIds,
    };
    if (form.password) payload.password = form.password;
    if (await users.save(editingUsername, payload)) reset();
  };

  const handleRemove = async (username) => {
    if ((await users.remove(username)) && editingUsername === username) reset();
  };

  return (
    <div className="ap-split">
      <Card
        className="ap-split-form"
        title={isEditing ? `Edit ${editingUsername}` : "Create user"}
        description={isEditing ? "Leave the password blank to keep it unchanged." : "Passwords need at least 12 characters."}
      >
        <form className="ap-form" onSubmit={submit}>
          <div>
            <label className="ap-label" htmlFor="user-name">Username</label>
            <input
              id="user-name"
              className="form-control"
              value={form.username}
              minLength={3}
              maxLength={64}
              onChange={(e) => setForm((c) => ({ ...c, username: e.target.value }))}
              required
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="ap-label" htmlFor="user-password">Password</label>
            <input
              id="user-password"
              className="form-control"
              type="password"
              placeholder={isEditing ? "New password (optional)" : ""}
              value={form.password}
              minLength={isEditing ? 0 : 12}
              maxLength={128}
              onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
              required={!isEditing}
              disabled={saving}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="ap-label" htmlFor="user-role">Role</label>
            <select
              id="user-role"
              className="form-select"
              value={form.role}
              onChange={(e) => setForm((c) => ({ ...c, role: e.target.value }))}
              disabled={saving}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <fieldset className="ap-fieldset">
            <legend className="ap-label">Contexts</legend>
            {contexts.active.length === 0 ? (
              <p className="is-muted">Create a context first to assign it to users.</p>
            ) : (
              <div className="ap-chips">
                {contexts.active.map((context) => {
                  const checked = form.contextIds.includes(context.id);
                  return (
                    <label key={context.id} className={`ap-chip ap-chip--toggle ${checked ? "is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleContext(context.id)}
                        disabled={saving}
                      />
                      {context.name}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <StatusMessage status={status} />

          <div className="ap-row">
            <button
              type="submit"
              className="ap-btn ap-btn--primary"
              disabled={saving || contexts.active.length === 0}
            >
              {saving ? "Saving…" : isEditing ? "Save user" : "Create user"}
            </button>
            {isEditing && (
              <button type="button" className="ap-btn ap-btn--ghost" onClick={reset} disabled={saving}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </Card>

      <div className="ap-stack ap-split-list">
        <Card title={`Active users (${active.length})`}>
          {loading && !active.length ? (
            <EmptyState>Loading users…</EmptyState>
          ) : active.length === 0 ? (
            <EmptyState>No users yet.</EmptyState>
          ) : (
            <div className="ap-table-wrap">
              <table className="ap-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Contexts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {active.map((user) => (
                    <tr key={user.id || user.username} className={normalizeUsername(user.username) === editingUsername ? "is-active" : ""}>
                      <td className="ap-strong">{user.username}</td>
                      <td>
                        <span className={`ap-badge ${user.role === "admin" ? "ap-badge--accent" : ""}`}>
                          {user.role}
                        </span>
                      </td>
                      <td><ContextChips contexts={user.contexts} /></td>
                      <td className="ap-cell-actions">
                        <button
                          type="button"
                          className="ap-btn ap-btn--ghost ap-btn--sm"
                          onClick={() => startEdit(user)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        <ConfirmButton onConfirm={() => handleRemove(user.username)} disabled={saving} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {deleted.length > 0 && (
          <Card title={`Deleted users (${deleted.length})`}>
            <div className="ap-table-wrap">
              <table className="ap-table">
                <tbody>
                  {deleted.map((user) => (
                    <tr key={user.id || user.username}>
                      <td className="is-muted">{user.username}</td>
                      <td><span className="ap-badge">{user.role}</span></td>
                      <td><ContextChips contexts={user.contexts} /></td>
                      <td className="ap-cell-actions">
                        <button
                          type="button"
                          className="ap-btn ap-btn--secondary ap-btn--sm"
                          onClick={() => users.restore(user.username)}
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default UsersSection;
