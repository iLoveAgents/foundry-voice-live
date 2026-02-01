import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface SampleLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SampleLayout({ title, description, children }: SampleLayoutProps) {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px' }}>
      <div style={{ marginBottom: '32px' }}>
        <Link to="/" style={{
          color: '#0078d4',
          textDecoration: 'none',
          fontSize: '14px',
          display: 'inline-flex',
          alignItems: 'center',
          marginBottom: '16px'
        }}>
          ← Back to Samples
        </Link>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: 600 }}>{title}</h1>
        {description && (
          <p style={{
            margin: 0,
            color: '#666',
            fontSize: '16px',
            lineHeight: '1.5'
          }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
