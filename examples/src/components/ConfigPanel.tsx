import { ReactNode } from 'react';

interface ConfigPanelProps {
  title?: string;
  children: ReactNode;
}

export function ConfigPanel({
  title = 'Configuration',
  children,
}: ConfigPanelProps): JSX.Element {
  return (
    <div className="config-panel">
      <h3 className="config-panel__title">{title}</h3>
      <div className="config-panel__content">{children}</div>
    </div>
  );
}

interface ConfigItemProps {
  label: string;
  value: string | ReactNode;
}

export function ConfigItem({ label, value }: ConfigItemProps): JSX.Element {
  return (
    <div className="config-item">
      <span className="config-item__label">{label}:</span>{' '}
      <span className="config-item__value">{value}</span>
    </div>
  );
}
