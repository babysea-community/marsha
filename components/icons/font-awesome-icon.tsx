import type { HTMLAttributes, SVGProps } from 'react';

import { cn } from '@/lib/utils';

export type FontAwesomeFamily = 'brands' | 'kit' | 'regular' | 'solid';

const FAMILY_CLASSES: Record<FontAwesomeFamily, string> = {
  brands: 'fa-brands',
  kit: 'fa-kit',
  regular: 'fa-regular',
  solid: 'fa-solid',
};

export type FontAwesomeIconProps = Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> & {
  family?: FontAwesomeFamily;
  fixedWidth?: boolean;
  icon: string;
};

export function FontAwesomeIcon({
  className,
  family = 'solid',
  fixedWidth = false,
  icon,
  ...props
}: FontAwesomeIconProps) {
  return (
    <i
      aria-hidden="true"
      {...props}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center leading-none',
        FAMILY_CLASSES[family],
        `fa-${icon}`,
        fixedWidth ? 'fa-fw' : null,
        className,
      )}
    />
  );
}

export function createFontAwesomeIcon(
  icon: string,
  family: FontAwesomeFamily = 'solid',
) {
  function CreatedFontAwesomeIcon({
    className,
    ...props
  }: SVGProps<SVGSVGElement>) {
    return (
      <FontAwesomeIcon
        {...(props as HTMLAttributes<HTMLElement>)}
        className={className}
        family={family}
        icon={icon}
      />
    );
  }

  CreatedFontAwesomeIcon.displayName = `FontAwesomeIcon(${family}:${icon})`;

  return CreatedFontAwesomeIcon;
}
