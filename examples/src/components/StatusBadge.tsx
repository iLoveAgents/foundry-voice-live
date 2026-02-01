interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const statusClass = status.toLowerCase();

  return (
    <div className={`status-badge status-badge--${statusClass}`}>
      <div className="status-badge__dot" />
      Status: {status}
    </div>
  );
}
