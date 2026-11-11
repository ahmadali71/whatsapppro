import React from 'react';
import { resolveMediaUrl } from '@/lib/api';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  isGroup?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

const DOT_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-2 h-2 border',
  sm: 'w-2.5 h-2.5 border',
  md: 'w-3 h-3 border-2',
  lg: 'w-3.5 h-3.5 border-2',
  xl: 'w-4 h-4 border-2',
};

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  isOnline,
  isGroup,
  className = '',
}) => {
  const resolvedSrc = resolveMediaUrl(src);

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {resolvedSrc ? (
        <img
          src={resolvedSrc}
          alt={name || 'Avatar'}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover bg-gray-200 dark:bg-[#2a3942]`}
        />
      ) : (
        <div
          className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-semibold text-white select-none ${
            isGroup
              ? 'bg-gradient-to-br from-[#00A884] to-[#075E54]'
              : 'bg-gradient-to-br from-[#128C7E] to-[#00A884]'
          }`}
        >
          {getInitials(name)}
        </div>
      )}
      {isOnline && (
        <span
          className={`absolute bottom-0 right-0 ${DOT_CLASSES[size]} rounded-full bg-[#25D366] border-white dark:border-[#111b21]`}
          title="Online"
        />
      )}
    </div>
  );
};
