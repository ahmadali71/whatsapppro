import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { RootStackParamList } from '../../types/mobile.types';
import { useTheme } from '../../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.hero}>
        <View style={[styles.logoCircle, { backgroundColor: theme.primary }]}>
          <Ionicons name="chatbubbles" size={64} color="#FFFFFF" />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Welcome to WhatsApp Pro</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Fast, private, end-to-end encrypted messaging, voice & video calls, and communities.
        </Text>

        <View style={[styles.featureCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <FeatureItem icon="lock-closed" text="Signal Protocol E2E Encryption" />
          <FeatureItem icon="videocam" text="HD WebRTC Audio & Video Calls" />
          <FeatureItem icon="people" text="Groups, Communities & Statuses" />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.terms, { color: theme.textMuted }]}>
          Read our Privacy Policy. Tap "Agree and Continue" to accept the Terms of Service.
        </Text>
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: theme.primary }]}
          onPress={() => navigation.navigate('PhoneRegister')}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>Agree and Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon} size={18} color={theme.primary} />
      <Text style={[styles.featureText, { color: theme.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', padding: 24 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 12, marginBottom: 28 },
  featureCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureText: { fontSize: 14, fontWeight: '600' },
  footer: { gap: 16, paddingBottom: 12 },
  terms: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  cta: {
    borderRadius: 28,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
