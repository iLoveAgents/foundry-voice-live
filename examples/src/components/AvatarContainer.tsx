import { ReactNode } from 'react';

interface AvatarContainerProps {
  children: ReactNode;
  variant?: 'default' | 'wide' | 'gradient';
}

export function AvatarContainer({
  children,
  variant = 'default',
}: AvatarContainerProps): JSX.Element {
  const className =
    variant === 'default'
      ? 'avatar-container'
      : `avatar-container avatar-container--${variant}`;

  return <div className={className}>{children}</div>;
}
