import { ReactNode, CSSProperties } from 'react';

interface SectionProps {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function Section({ title, children, style }: SectionProps) {
  return (
    <div style={{ marginBottom: '32px', ...style }}>
      {title && (
        <h2 style={{
          margin: '0 0 16px 0',
          fontSize: '20px',
          fontWeight: 600,
          color: '#333'
        }}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
