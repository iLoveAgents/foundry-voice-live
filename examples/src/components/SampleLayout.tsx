import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface SampleLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SampleLayout({
  title,
  description,
  children,
}: SampleLayoutProps): JSX.Element {
  return (
    <div className="sample-layout">
      <div className="sample-layout__header">
        <Link to="/" className="sample-layout__back-link">
          ← Back to Samples
        </Link>
        <h1 className="sample-layout__title">{title}</h1>
        {description && (
          <p className="sample-layout__description">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
