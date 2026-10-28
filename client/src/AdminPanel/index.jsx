import { useState } from "react";
import useContexts from "./hooks/useContexts";
import useUsers from "./hooks/useUsers";
import ContextsSection from "./sections/ContextsSection";
import FiltersSection from "./sections/FiltersSection";
import PluginsSection from "./sections/PluginsSection";
import RunsSection from "./sections/RunsSection";
import UsersSection from "./sections/UsersSection";
import "./AdminPanel.css";

const AdminPanel = ({ runs, onRunDeleted, onUserCreated }) => {
  const [section, setSection] = useState("runs");

  const users = useUsers({ onUserCreated });
  // Renaming/removing a context changes users' context lists, so refresh them.
  const contexts = useContexts({ onChanged: users.reload });

  const nav = [
    { id: "runs", label: "Runs", hint: "Export and delete", count: Array.isArray(runs) ? runs.length : 0 },
    { id: "contexts", label: "Contexts", hint: "Groups for runs and access", count: contexts.active.length },
    { id: "users", label: "Users", hint: "Accounts and roles", count: users.active.length },
    { id: "filters", label: "Filters", hint: "Custom data filters" },
    { id: "plugins", label: "Plugins", hint: "Per-context availability" },
  ];
  const current = nav.find((n) => n.id === section);

  return (
    <div className="ap-shell">
      <nav className="ap-nav" aria-label="Admin sections">
        <div className="ap-nav-title">Admin</div>
        {nav.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ap-nav-item ${section === item.id ? "is-on" : ""}`}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => setSection(item.id)}
          >
            <span>{item.label}</span>
            {item.count !== undefined && <span className="ap-nav-count">{item.count}</span>}
          </button>
        ))}
      </nav>

      <main className="ap-main">
        <header className="ap-page-head">
          <h2>{current.label}</h2>
          <p>{current.hint}</p>
        </header>

        {section === "runs" && <RunsSection runs={runs} onRunDeleted={onRunDeleted} />}
        {section === "contexts" && <ContextsSection contexts={contexts} />}
        {section === "users" && <UsersSection users={users} contexts={contexts} />}
        {section === "filters" && <FiltersSection />}
        {section === "plugins" && <PluginsSection contexts={contexts} />}
      </main>
    </div>
  );
};

export default AdminPanel;
