interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  // First word only, so labels like "reconnecting (attempt 2)" still pick up the state style
  const statusClass = status.toLowerCase().split(/[\s(]/)[0];

  return (
    <div className={`status-badge status-badge--${statusClass}`}>
      <div className="status-badge__dot" />
      Status: {status}
    </div>
  );
}
