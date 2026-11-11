import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { resolveMediaUrl } from '../services/api';
import { useTheme } from '../theme/colors';

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  isOnline?: boolean;
  isGroup?: boolean;
}

export function Avatar({ uri, name, size = 48, isOnline = false, isGroup = false }: AvatarProps) {
  const theme = useTheme();
  const resolvedUri = resolveMediaUrl(uri);
  const initials = (name || (isGroup ? 'G' : 'U'))
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <View style={{ width: size, height: size }}>
      {resolvedUri ? (
        <Image
          source={{ uri: resolvedUri }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.border,
          }}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: isGroup ? '#008069' : '#667781',
            },
          ]}
        >
          <Text style={[styles.initials, { fontSize: Math.max(12, size * 0.36) }]}>
            {initials || '?'}
          </Text>
        </View>
      )}
      {isOnline && (
        <View
          style={[
            styles.onlineDot,
            {
              backgroundColor: theme.online,
              borderColor: theme.background,
              width: Math.max(11, size * 0.26),
              height: Math.max(11, size * 0.26),
              borderRadius: Math.max(6, size * 0.13),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderWidth: 2,
  },
});
