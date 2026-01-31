interface StatusBadgeProps {
  status: string;
}

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  disconnected: { bg: '#f5f5f5', text: '#666', border: '#ddd' },
  connecting: { bg: '#fff4e5', text: '#e67700', border: '#ffcc80' },
  connected: { bg: '#e8f5e9', text: '#2e7d32', border: '#81c784' },
  disconnecting: { bg: '#fff4e5', text: '#e67700', border: '#ffcc80' },
  failed: { bg: '#ffebee', text: '#c62828', border: '#ef9a9a' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const colors = (statusColors[status.toLowerCase()] ?? statusColors.disconnected) as { bg: string; text: string; border: string };

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '8px 16px',
      borderRadius: '6px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      fontSize: '14px',
      fontWeight: 500,
      color: colors.text,
      marginBottom: '24px'
    }}>
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: colors.text,
        marginRight: '8px',
        animation: status.toLowerCase() === 'connecting' ? 'pulse 1.5s infinite' : 'none'
      }} />
      Status: {status}
    </div>
  );
}
