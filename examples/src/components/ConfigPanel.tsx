import { ReactNode } from 'react';

interface ConfigPanelProps {
  title?: string;
  children: ReactNode;
}

export function ConfigPanel({ title = 'Configuration', children }: ConfigPanelProps) {
  return (
    <div style={{
      backgroundColor: '#f8f9fa',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '24px'
    }}>
      <h3 style={{
        margin: '0 0 16px 0',
        fontSize: '16px',
        fontWeight: 600,
        color: '#333'
      }}>
        {title}
      </h3>
      <div style={{ fontSize: '14px', lineHeight: '1.8', color: '#555' }}>
        {children}
      </div>
    </div>
  );
}

export function ConfigItem({ label, value }: { label: string; value: string | ReactNode }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <span style={{ fontWeight: 500, color: '#333' }}>{label}:</span>{' '}
      <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#0078d4' }}>{value}</span>
    </div>
  );
}
