import { ReactNode } from 'react';

interface SectionProps {
  title?: string;
  children: ReactNode;
}

export function Section({ title, children }: SectionProps): JSX.Element {
  return (
    <div className="section">
      {title && <h2 className="section__title">{title}</h2>}
      {children}
    </div>
  );
}
