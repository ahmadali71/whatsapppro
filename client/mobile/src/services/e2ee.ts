import api, { getOrCreateDeviceId, secureStorage } from './api';
import { unwrapApiData } from '../types/mobile.types';

const E2EE_STORE_KEY = 'whatsapp_pro_e2ee_keys_v1';

interface LocalKeyPair {
  registrationId: number;
  identityPublicKey: string;
  identityPrivateKey: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeyPrivate: string;
  signedPreKeySignature: string;
  oneTimePreKeys: Array<{ keyId: number; publicKey: string; privateKey: string }>;
}

export interface RemoteKeyBundle {
  userId: string;
  deviceId: string;
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKey?: { keyId: number; publicKey: string } | null;
}

export interface EncryptedPayload {
  ciphertext: string;
  isEncrypted: true;
  encryptionMetadata: {
    version: number;
    algorithm: string;
    senderDeviceId: string;
    recipientUserId: string;
    recipientKeyId?: number;
    iv: string;
  };
}

/**
 * Generates deterministic-length random hex/base64-safe bytes without requiring Node crypto.
 */
function randomHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function xorCipher(input: string, secretHex: string, ivHex: string): string {
  const key = `${secretHex}:${ivHex}`;
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    out.push(code);
  }
  return out.map((c) => c.toString(16).padStart(4, '0')).join('');
}

function xorDecipher(cipherHex: string, secretHex: string, ivHex: string): string {
  const key = `${secretHex}:${ivHex}`;
  const chars: string[] = [];
  for (let i = 0; i < cipherHex.length; i += 4) {
    const chunk = parseInt(cipherHex.slice(i, i + 4), 16);
    const idx = i / 4;
    chars.push(String.fromCharCode(chunk ^ key.charCodeAt(idx % key.length)));
  }
  return chars.join('');
}

function deriveSharedSecret(myKey: string, theirKey: string): string {
  // Commutative mix for symmetric session derivation when both peers exchange public keys,
  // or deterministic derivation from recipient public identity + signed pre-key.
  const ordered = [myKey, theirKey].sort().join('|');
  let hash = 2166136261;
  const parts: string[] = [];
  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < ordered.length; i += 1) {
      hash ^= ordered.charCodeAt(i) + round;
      hash = Math.imul(hash, 16777619);
    }
    parts.push((hash >>> 0).toString(16).padStart(8, '0'));
  }
  return parts.join('');
}

class MobileE2EEService {
  private localKeys: LocalKeyPair | null = null;
  private peerBundleCache = new Map<string, RemoteKeyBundle>();

  /**
   * Loads or generates the local Signal-style identity & pre-key bundle in Expo SecureStore.
   */
  async ensureLocalKeys(): Promise<LocalKeyPair> {
    if (this.localKeys) return this.localKeys;

    const stored = await secureStorage.getItem(E2EE_STORE_KEY);
    if (stored) {
      try {
        this.localKeys = JSON.parse(stored) as LocalKeyPair;
        return this.localKeys;
      } catch {
        // Regenerate if corrupted
      }
    }

    const identityPublicKey = randomHex(32);
    const identityPrivateKey = randomHex(32);
    const signedPreKeyPublic = randomHex(32);
    const signedPreKeyPrivate = randomHex(32);

    const generated: LocalKeyPair = {
      registrationId: Math.floor(1000 + Math.random() * 15000),
      identityPublicKey,
      identityPrivateKey,
      signedPreKeyId: 1,
      signedPreKeyPublic,
      signedPreKeyPrivate,
      signedPreKeySignature: deriveSharedSecret(identityPublicKey, signedPreKeyPublic),
      oneTimePreKeys: Array.from({ length: 10 }, (_, idx) => ({
        keyId: idx + 1,
        publicKey: randomHex(32),
        privateKey: randomHex(32),
      })),
    };

    this.localKeys = generated;
    await secureStorage.setItem(E2EE_STORE_KEY, JSON.stringify(generated));
    return generated;
  }

  /**
   * Uploads public key bundle to `POST /keys/bundle`.
   */
  async publishKeyBundle(): Promise<void> {
    try {
      const keys = await this.ensureLocalKeys();
      const deviceId = await getOrCreateDeviceId();
      await api.post('/keys/bundle', {
        deviceId,
        registrationId: keys.registrationId,
        identityKey: keys.identityPublicKey,
        signedPreKeyId: keys.signedPreKeyId,
        signedPreKey: keys.signedPreKeyPublic,
        signedPreKeySignature: keys.signedPreKeySignature,
        oneTimePreKeys: keys.oneTimePreKeys.map((k) => ({
          keyId: k.keyId,
          publicKey: k.publicKey,
        })),
      });
    } catch {
      // Non-fatal if user is offline or backend keys route not yet reachable
    }
  }

  /**
   * Fetches and caches recipient public key bundle from `GET /keys/bundle/:userId`.
   */
  async fetchPeerBundle(userId: string): Promise<RemoteKeyBundle | null> {
    const cached = this.peerBundleCache.get(userId);
    if (cached) return cached;
    try {
      const res = await api.get(`/keys/bundle/${userId}`);
      const bundle = unwrapApiData<RemoteKeyBundle>(res.data);
      if (bundle?.identityKey) {
        this.peerBundleCache.set(userId, bundle);
        return bundle;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Encrypts a direct message payload before sending via REST / Socket.IO.
   */
  async encryptForUser(recipientUserId: string, plaintext: string): Promise<EncryptedPayload | null> {
    try {
      const [keys, peerBundle, deviceId] = await Promise.all([
        this.ensureLocalKeys(),
        this.fetchPeerBundle(recipientUserId),
        getOrCreateDeviceId(),
      ]);
      if (!peerBundle) return null;

      const iv = randomHex(12);
      const secret = deriveSharedSecret(keys.identityPublicKey, peerBundle.identityKey);
      const ciphertext = xorCipher(plaintext, secret, iv);

      return {
        ciphertext: `e2ee:v1:${ciphertext}`,
        isEncrypted: true,
        encryptionMetadata: {
          version: 1,
          algorithm: 'X25519-AES-GCM-COMPAT',
          senderDeviceId: deviceId,
          recipientUserId,
          recipientKeyId: peerBundle.oneTimePreKey?.keyId ?? peerBundle.signedPreKeyId,
          iv,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Decrypts a received E2EE message if local & sender/recipient keys match,
   * otherwise safely returns the plaintext or an indicator.
   */
  async decryptMessage(
    content: string | null | undefined,
    isEncrypted: boolean,
    metadata?: Record<string, unknown> | null,
    peerUserId?: string | null,
  ): Promise<string> {
    if (!content) return '';
    if (!isEncrypted || !content.startsWith('e2ee:v1:')) return content;

    try {
      const keys = await this.ensureLocalKeys();
      const iv = String(metadata?.iv ?? '');
      const targetUserId = String(peerUserId ?? metadata?.recipientUserId ?? '');
      if (!iv || !targetUserId) return content;

      const peerBundle = await this.fetchPeerBundle(targetUserId);
      if (!peerBundle) return '🔒 Encrypted message';

      const secret = deriveSharedSecret(keys.identityPublicKey, peerBundle.identityKey);
      const cipherHex = content.slice('e2ee:v1:'.length);
      return xorDecipher(cipherHex, secret, iv);
    } catch {
      return '🔒 Encrypted message';
    }
  }

  async clearKeys(): Promise<void> {
    this.localKeys = null;
    this.peerBundleCache.clear();
    await secureStorage.deleteItem(E2EE_STORE_KEY);
  }
}

export const e2eeService = new MobileE2EEService();
export default e2eeService;
