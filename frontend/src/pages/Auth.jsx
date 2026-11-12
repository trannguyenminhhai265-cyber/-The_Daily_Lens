import { useState } from "react";
import { api } from "../api";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ErrorMessage } from "../components/common";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: "", password: "" });
  const [state, setState] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: null });
    try {
      await login(form.login, form.password);
      navigate((location.state && location.state.from) || "/", {
        replace: true,
      });
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const recover = async () => {
    setState({ busy: true, error: null });
    try {
      await api("/auth/recover", {
        method: "POST",
        body: { email: form.login },
      });
      setState({ busy: false, recoverySent: true });
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Đăng nhập</h1>
        <ErrorMessage error={state.error} />
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            required
          />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={state.busy}>
          {state.busy ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={recover}
          disabled={state.busy || !form.login.includes("@")}
        >
          Quên mật khẩu?
        </button>
        {state.recoverySent && (
          <p className="muted">
            Nếu email này có tài khoản, liên kết khôi phục mật khẩu sẽ được gửi tới.
          </p>
        )}
        <p className="muted small">
          Chưa có tài khoản? <Link to="/register">Tạo tài khoản</Link>
        </p>
      </form>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    email: "",
    display_name: "",
    password: "",
    confirm: "",
  });
  const [state, setState] = useState({ busy: false, error: null });

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setState({ busy: false, error: new Error("Mật khẩu nhập lại không khớp") });
      return;
    }
    setState({ busy: true, error: null });
    try {
      const { confirm, ...payload } = form; // eslint-disable-line no-unused-vars
      const result = await register(payload);
      if (result.confirmationRequired) {
        setState({ busy: false, error: null, confirmationRequired: true });
        return;
      }
      navigate("/profile");
    } catch (error) {
      setState({ busy: false, error });
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  if (state.confirmationRequired)
    return (
      <div className="container auth-wrap">
        <div className="auth-card">
          <h1>Kiểm tra email của bạn</h1>
          <p>
            Hãy mở liên kết xác nhận trong email để kích hoạt tài khoản, sau đó đăng nhập.
          </p>
          <Link to="/login">Quay lại đăng nhập</Link>
        </div>
      </div>
    );

  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Tạo tài khoản</h1>
        <ErrorMessage error={state.error} />
        <label>
          Tên đăng nhập
          <input
            value={form.username}
            onChange={set("username")}
            pattern="[a-zA-Z0-9_]{3,30}"
            title="3-30 ký tự gồm chữ cái, chữ số hoặc dấu gạch dưới"
            required
          />
        </label>
        <label>
          Tên hiển thị
          <input
            value={form.display_name}
            onChange={set("display_name")}
            maxLength={60}
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
        <label>
          Mật khẩu
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
            minLength={8}
            required
          />
          <span className="hint">
            Tối thiểu 8 ký tự, gồm chữ cái và chữ số.
          </span>
        </label>
        <label>
          Nhập lại mật khẩu
          <input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set("confirm")}
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={state.busy}>
          {state.busy ? "Đang tạo…" : "Tạo tài khoản"}
        </button>
        <p className="muted small">
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </p>
      </form>
    </div>
  );
}

export function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState({ busy: false, error: null, ok: false });
  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setState({ error: new Error("Mật khẩu nhập lại không khớp") });
      return;
    }
    setState({ busy: true });
    try {
      await api("/auth/reset-password", { method: "POST", body: { password } });
      setState({ ok: true });
    } catch (error) {
      setState({ error });
    }
  };
  return (
    <div className="container auth-wrap">
      <form className="auth-card form" onSubmit={submit}>
        <h1>Đặt lại mật khẩu</h1>
        <ErrorMessage error={state.error} />
        {state.ok ? (
          <p>
            Đã cập nhật mật khẩu. <Link to="/login">Đăng nhập</Link>
          </p>
        ) : (
          <>
            <p className="muted">
              Hãy mở liên kết khôi phục trong email trước khi đặt mật khẩu
              mới.
            </p>
            <label>
              Mật khẩu mới
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              Nhập lại mật khẩu
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <button className="btn btn-primary" disabled={state.busy}>
              Lưu mật khẩu
            </button>
          </>
        )}
      </form>
    </div>
  );
}
