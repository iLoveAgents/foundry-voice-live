interface ErrorPanelProps {
  error: string | null;
}

export function ErrorPanel({ error }: ErrorPanelProps): JSX.Element | null {
  if (!error) return null;

  return (
    <div className="alert alert--error">
      <strong className="alert__title">Error:</strong>
      <div className="alert__content">{error}</div>
    </div>
  );
}
