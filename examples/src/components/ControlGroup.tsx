import { ReactNode } from 'react';

interface ControlGroupProps {
  children: ReactNode;
}

export function ControlGroup({ children }: ControlGroupProps) {
  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      marginBottom: '24px',
      flexWrap: 'wrap'
    }}>
      {children}
    </div>
  );
}
