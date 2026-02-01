import { ReactNode } from 'react';

interface AlertBoxProps {
  variant: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  children: ReactNode;
}

export function AlertBox({ variant, title, children }: AlertBoxProps): JSX.Element {
  return (
    <div className={`alert alert--${variant}`}>
      {title && <h3 className="alert__title">{title}</h3>}
      <div className="alert__content">{children}</div>
    </div>
  );
}
