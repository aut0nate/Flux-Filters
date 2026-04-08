type ThemeMode = "dark" | "light";

interface ThemeToggleProps {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}

function DarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14.5 3.2a8.8 8.8 0 1 0 6.3 15.1 8 8 0 1 1-6.3-15.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <path
        d="M12 1.8v3M12 19.2v3M4.8 12h-3M22.2 12h-3M5.7 5.7 3.6 3.6M20.4 20.4l-2.1-2.1M18.3 5.7l2.1-2.1M5.7 18.3l-2.1 2.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button
        type="button"
        className={theme === "dark" ? "is-active" : ""}
        onClick={() => onChange("dark")}
        aria-pressed={theme === "dark"}
        aria-label="Dark theme"
        title="Dark theme"
      >
        <DarkIcon />
      </button>
      <button
        type="button"
        className={theme === "light" ? "is-active" : ""}
        onClick={() => onChange("light")}
        aria-pressed={theme === "light"}
        aria-label="Light theme"
        title="Light theme"
      >
        <LightIcon />
      </button>
    </div>
  );
}
