import { ReactNode } from 'react';

interface ControlGroupProps {
  children: ReactNode;
}

export function ControlGroup({ children }: ControlGroupProps): JSX.Element {
  return <div className="control-group">{children}</div>;
}
