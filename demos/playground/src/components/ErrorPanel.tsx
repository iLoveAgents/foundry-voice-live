interface ErrorPanelProps {
  error: string | null;
}

export function ErrorPanel({ error }: ErrorPanelProps) {
  if (!error) return null;

  return (
    <div style={{
      backgroundColor: '#ffebee',
      border: '1px solid #ef9a9a',
      borderRadius: '8px',
      padding: '16px 20px',
      marginBottom: '24px',
      color: '#c62828',
      fontSize: '14px',
      lineHeight: '1.6'
    }}>
      <strong style={{ display: 'block', marginBottom: '4px' }}>Error:</strong>
      {error}
    </div>
  );
}
