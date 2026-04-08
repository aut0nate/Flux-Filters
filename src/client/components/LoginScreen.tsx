import { useState } from "react";

import ThemeToggle from "./ThemeToggle";

interface LoginScreenProps {
  initialServerUrl: string;
  onSubmit: (payload: { serverUrl: string; apiToken: string }) => Promise<void>;
  loading: boolean;
  error: string;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
}

export default function LoginScreen({
  initialServerUrl,
  onSubmit,
  loading,
  error,
  theme,
  onThemeChange
}: LoginScreenProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      serverUrl,
      apiToken
    });
  }

  return (
    <div className="login-shell">
      <div className="login-glow" />
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__topbar">
          <ThemeToggle theme={theme} onChange={onThemeChange} />
        </div>

        <div className="brand-mark">m</div>
        <div className="login-copy">
          <h1>Login to your server</h1>
          <p>Connect directly to Miniflux with your API token. Nothing is stored on the server.</p>
        </div>

        <label className="field">
          <span>Server address</span>
          <div className="field__input">
            <span className="field__icon">⌂</span>
            <input
              type="url"
              inputMode="url"
              required
              placeholder="https://miniflux.example.com"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </div>
        </label>

        <label className="field">
          <span>API token</span>
          <div className="field__input">
            <span className="field__icon">⌘</span>
            <input
              type={showToken ? "text" : "password"}
              required
              placeholder="Paste your Miniflux API token"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
            />
            <button
              type="button"
              className="field__toggle"
              onClick={() => setShowToken((value) => !value)}
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <button className="login-submit" type="submit" disabled={loading}>
          {loading ? "Checking…" : "Login"}
        </button>

        <p className="login-footnote">
          Need more info?{" "}
          <a href="https://miniflux.app/" target="_blank" rel="noreferrer">
            Go to Miniflux official website
          </a>
        </p>
      </form>
    </div>
  );
}
