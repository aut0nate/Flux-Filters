interface BackButtonProps {
  label?: string;
  onClick: () => void;
}

export default function BackButton({ label = "Back", onClick }: BackButtonProps) {
  return (
    <button type="button" className="ghost-button back-button" onClick={onClick}>
      <span aria-hidden="true" className="back-button__icon">
        &larr;
      </span>
      <span>{label}</span>
    </button>
  );
}
