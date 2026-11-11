import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Avatar, Empty, ErrorMessage } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS, setPageMeta } from "../utils";

export function MyProfile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    display_name: user.display_name,
    email: user.email,
  });
  const [pw, setPw] = useState({
    current_password: "",
    new_password: "",
    confirm: "",
  });
  const [profileState, setProfileState] = useState({
    busy: false,
    error: null,
    ok: false,
  });
  const [pwState, setPwState] = useState({
    busy: false,
    error: null,
    ok: false,
  });

  useEffect(() => setPageMeta("My profile"), []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileState({ busy: true, error: null, ok: false });
    try {
      const { user: updated } = await api("/auth/me", {
        method: "PUT",
        body: form,
      });
      setUser(updated);
      setProfileState({ busy: false, error: null, ok: true });
    } catch (error) {
      setProfileState({ busy: false, error, ok: false });
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) {
      setPwState({
        busy: false,
        error: new Error("New passwords do not match"),
        ok: false,
      });
      return;
    }
    setPwState({ busy: true, error: null, ok: false });
    try {
      await api("/auth/me/password", {
        method: "PUT",
        body: {
          current_password: pw.current_password,
          new_password: pw.new_password,
        },
      });
      setPw({ current_password: "", new_password: "", confirm: "" });
      setPwState({ busy: false, error: null, ok: true });
    } catch (error) {
      setPwState({ busy: false, error, ok: false });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="container narrow">
      <header className="profile-header">
        <Avatar user={{ ...user, ...form }} size={88} />
        <div>
          <h1>My profile</h1>
          <div className="muted">
            @{user.username} · {ROLE_LABELS[user.role]}
          </div>
        </div>
      </header>

      <div className="two-col">
        <form className="card form" onSubmit={saveProfile}>
          <h2>Profile details</h2>
          <ErrorMessage error={profileState.error} />
          {profileState.ok && (
            <div className="alert alert-success">
              Profile saved. Email changes may require confirmation.
            </div>
          )}
          <label>
            Display name
            <input
              value={form.display_name}
              onChange={set("display_name")}
              maxLength={60}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={set("email")}
              required
            />
          </label>
          <button className="btn btn-primary" disabled={profileState.busy}>
            Save profile
          </button>
        </form>

        <form className="card form" onSubmit={changePassword}>
          <h2>Change password</h2>
          <ErrorMessage error={pwState.error} />
          {pwState.ok && (
            <div className="alert alert-success">Password updated.</div>
          )}
          <label>
            Current password
            <input
              type="password"
              value={pw.current_password}
              onChange={(e) =>
                setPw({ ...pw, current_password: e.target.value })
              }
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={pw.new_password}
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              required
            />
          </label>
          <button className="btn btn-primary" disabled={pwState.busy}>
            Update password
          </button>
        </form>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="container narrow">
      <Empty>
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist.</p>
        <Link to="/" className="btn btn-primary">
          Back to home
        </Link>
      </Empty>
    </div>
  );
}
