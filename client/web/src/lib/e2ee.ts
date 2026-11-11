import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  StorageType,
  Direction,
  KeyPairType,
  PreKeyType,
  SignedPublicPreKeyType,
} from '@privacyresearch/libsignal-protocol-typescript';
import { api, getOrCreateDeviceId, unwrapData } from './api';

const IDB_NAME = 'whatsapp_pro_e2ee';
const IDB_STORE = 'signal_keys';
const LS_PREFIX = 'wp_e2ee_';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function serializeValue(val: unknown): string {
  if (val instanceof ArrayBuffer) {
    return JSON.stringify({ __ab: arrayBufferToBase64(val) });
  }
  if (val && typeof val === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v instanceof ArrayBuffer) {
        obj[k] = { __ab: arrayBufferToBase64(v) };
      } else {
        obj[k] = v;
      }
    }
    return JSON.stringify(obj);
  }
  return JSON.stringify(val);
}

function deserializeValue<T = unknown>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (typeof record.__ab === 'string') {
      return base64ToArrayBuffer(record.__ab) as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).__ab === 'string') {
        out[k] = base64ToArrayBuffer((v as Record<string, string>).__ab);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }
  return parsed as T;
}

class HybridKeyStore implements StorageType {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryCache = new Map<string, string>();

  private getDb(): Promise<IDBDatabase> | null {
    if (typeof indexedDB === 'undefined') return null;
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private async getItem<T>(key: string): Promise<T | undefined> {
    if (this.memoryCache.has(key)) {
      return deserializeValue<T>(this.memoryCache.get(key) || null);
    }
    try {
      const db = await this.getDb();
      if (db) {
        const val = await new Promise<string | undefined>((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result as string | undefined);
          req.onerror = () => reject(req.error);
        });
        if (val !== undefined) {
          this.memoryCache.set(key, val);
          return deserializeValue<T>(val);
        }
      }
    } catch {
      // Fall back to localStorage
    }
    const lsVal = localStorage.getItem(LS_PREFIX + key);
    if (lsVal) {
      this.memoryCache.set(key, lsVal);
      return deserializeValue<T>(lsVal);
    }
    return undefined;
  }

  private async setItem(key: string, value: unknown): Promise<void> {
    const serialized = serializeValue(value);
    this.memoryCache.set(key, serialized);
    try {
      localStorage.setItem(LS_PREFIX + key, serialized);
    } catch {
      // Ignore quota errors on localStorage
    }
    try {
      const db = await this.getDb();
      if (db) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const req = store.put(serialized, key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    } catch {
      // Fallback already persisted to localStorage
    }
  }

  private async removeItem(key: string): Promise<void> {
    this.memoryCache.delete(key);
    localStorage.removeItem(LS_PREFIX + key);
    try {
      const db = await this.getDb();
      if (db) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }
    } catch {
      // Ignore
    }
  }

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    return this.getItem<KeyPairType>('identityKey');
  }

  async setIdentityKeyPair(keyPair: KeyPairType): Promise<void> {
    await this.setItem('identityKey', keyPair);
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return this.getItem<number>('registrationId');
  }

  async setLocalRegistrationId(id: number): Promise<void> {
    await this.setItem('registrationId', id);
  }

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction,
  ): Promise<boolean> {
    const existing = await this.getItem<ArrayBuffer>(`identityKey:${identifier}`);
    if (!existing) return true;
    return arrayBufferToBase64(existing) === arrayBufferToBase64(identityKey);
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const existing = await this.getItem<ArrayBuffer>(`identityKey:${encodedAddress}`);
    await this.setItem(`identityKey:${encodedAddress}`, publicKey);
    if (!existing) return false;
    return arrayBufferToBase64(existing) !== arrayBufferToBase64(publicKey);
  }

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return this.getItem<KeyPairType>(`preKey:${keyId}`);
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.setItem(`preKey:${keyId}`, keyPair);
  }

  async removePreKey(keyId: string | number): Promise<void> {
    await this.removeItem(`preKey:${keyId}`);
  }

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    return this.getItem<KeyPairType>(`signedPreKey:${keyId}`);
  }

  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.setItem(`signedPreKey:${keyId}`, keyPair);
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    await this.removeItem(`signedPreKey:${keyId}`);
  }

  async loadSession(encodedAddress: string): Promise<string | undefined> {
    return this.getItem<string>(`session:${encodedAddress}`);
  }

  async storeSession(encodedAddress: string, record: string): Promise<void> {
    await this.setItem(`session:${encodedAddress}`, record);
  }

  async removeSession(encodedAddress: string): Promise<void> {
    await this.removeItem(`session:${encodedAddress}`);
  }

  async removeAllSessions(identifier: string): Promise<void> {
    const prefix = `${LS_PREFIX}session:${identifier}`;
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith(prefix)) {
        localStorage.removeItem(k);
      }
    });
  }
}

export interface RemoteKeyBundle {
  userId: string;
  deviceId: string | number;
  registrationId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKey?: {
    keyId: number;
    publicKey: string;
  } | null;
}

export interface EncryptedPayloadEnvelope {
  v: number;
  type: number; // 3 = PreKeyWhisperMessage, 1 = WhisperMessage
  body: string; // base64 or binary string encoded
  senderDeviceId: number;
}

class E2EEManager {
  private store = new HybridKeyStore();
  private initialized = false;

  async initializeAndUploadKeys(force = false): Promise<{ registrationId: number; fingerprint: string } | null> {
    try {
      let registrationId = await this.store.getLocalRegistrationId();
      let identityKeyPair = await this.store.getIdentityKeyPair();

      if (!registrationId || !identityKeyPair || force) {
        registrationId = KeyHelper.generateRegistrationId();
        identityKeyPair = await KeyHelper.generateIdentityKeyPair();
        await this.store.setLocalRegistrationId(registrationId);
        await this.store.setIdentityKeyPair(identityKeyPair);

        const signedPreKeyId = 1;
        const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
        await this.store.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

        const oneTimePreKeys: Array<{ keyId: number; publicKey: string }> = [];
        for (let i = 1; i <= 20; i++) {
          const preKey = await KeyHelper.generatePreKey(i);
          await this.store.storePreKey(i, preKey.keyPair);
          oneTimePreKeys.push({
            keyId: preKey.keyId,
            publicKey: arrayBufferToBase64(preKey.keyPair.pubKey),
          });
        }

        await api.post('/keys/bundle', {
          deviceId: getOrCreateDeviceId(),
          registrationId,
          identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
          signedPreKeyId,
          signedPreKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
          signedPreKeySignature: arrayBufferToBase64(signedPreKey.signature),
          oneTimePreKeys,
        });
      }

      this.initialized = true;
      const fp = await this.getOwnFingerprint();
      return { registrationId, fingerprint: fp };
    } catch (err) {
      console.warn('[E2EE] Key initialization/upload skipped or failed:', err);
      return null;
    }
  }

  async getOwnFingerprint(): Promise<string> {
    const idKey = await this.store.getIdentityKeyPair();
    if (!idKey) return 'Not initialized';
    const digest = await crypto.subtle.digest('SHA-256', idKey.pubKey);
    const bytes = Array.from(new Uint8Array(digest)).slice(0, 12);
    return bytes.map((b) => b.toString(10).padStart(3, '0')).join(' ');
  }

  private async ensureSession(recipientUserId: string): Promise<SignalProtocolAddress> {
    const address = new SignalProtocolAddress(recipientUserId, 1);
    const existing = await this.store.loadSession(address.toString());
    if (existing) {
      return address;
    }

    const res = await api.get(`/keys/bundle/${recipientUserId}`);
    const bundle = unwrapData<RemoteKeyBundle>(res.data);

    const builder = new SessionBuilder(this.store, address);
    await builder.processPreKey({
      registrationId: bundle.registrationId,
      identityKey: base64ToArrayBuffer(bundle.identityKey),
      signedPreKey: {
        keyId: bundle.signedPreKeyId,
        publicKey: base64ToArrayBuffer(bundle.signedPreKey),
        signature: base64ToArrayBuffer(bundle.signedPreKeySignature),
      } as SignedPublicPreKeyType,
      preKey: bundle.oneTimePreKey
        ? ({
            keyId: bundle.oneTimePreKey.keyId,
            publicKey: base64ToArrayBuffer(bundle.oneTimePreKey.publicKey),
          } as PreKeyType)
        : undefined,
    });

    return address;
  }

  async encryptMessage(
    recipientUserId: string,
    plaintext: string,
  ): Promise<{ ciphertext: string; metadata: Record<string, unknown> } | null> {
    try {
      if (!this.initialized) {
        await this.initializeAndUploadKeys();
      }
      const address = await this.ensureSession(recipientUserId);
      const cipher = new SessionCipher(this.store, address);
      const encoded = new TextEncoder().encode(plaintext).buffer;
      const encrypted = await cipher.encrypt(encoded);

      const envelope: EncryptedPayloadEnvelope = {
        v: 1,
        type: encrypted.type,
        body: btoa(encrypted.body || ''),
        senderDeviceId: 1,
      };
      return {
        ciphertext: JSON.stringify(envelope),
        metadata: {
          algorithm: 'signal-v1',
          messageType: encrypted.type,
          recipientUserId,
        },
      };
    } catch (err) {
      console.warn('[E2EE] Failed to encrypt with Signal session, falling back to plaintext transport:', err);
      return null;
    }
  }

  async decryptMessage(senderUserId: string, content: string): Promise<string> {
    try {
      const parsed = JSON.parse(content) as Partial<EncryptedPayloadEnvelope>;
      if (!parsed || parsed.v !== 1 || !parsed.body || typeof parsed.type !== 'number') {
        return content;
      }

      const address = new SignalProtocolAddress(senderUserId, parsed.senderDeviceId || 1);
      const cipher = new SessionCipher(this.store, address);
      const binaryBody = atob(parsed.body);

      let plaintextBuf: ArrayBuffer;
      if (parsed.type === 3) {
        plaintextBuf = await cipher.decryptPreKeyWhisperMessage(binaryBody, 'binary');
      } else {
        plaintextBuf = await cipher.decryptWhisperMessage(binaryBody, 'binary');
      }

      return new TextDecoder().decode(plaintextBuf);
    } catch {
      // Return original or indicator if message is not Signal-encrypted JSON
      if (content.startsWith('{"v":1,"type":')) {
        return '🔒 Encrypted message (unable to decrypt on this device)';
      }
      return content;
    }
  }

  // Web Crypto AES-GCM helpers for symmetric client-side media encryption
  async generateSymmetricKey(): Promise<{ keyBase64: string; ivBase64: string }> {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const rawKey = await crypto.subtle.exportKey('raw', key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return {
      keyBase64: arrayBufferToBase64(rawKey),
      ivBase64: arrayBufferToBase64(iv.buffer),
    };
  }

  async encryptMediaBuffer(
    buffer: ArrayBuffer,
    keyBase64: string,
    ivBase64: string,
  ): Promise<ArrayBuffer> {
    const rawKey = base64ToArrayBuffer(keyBase64);
    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer);
  }

  async decryptMediaBuffer(
    encryptedBuffer: ArrayBuffer,
    keyBase64: string,
    ivBase64: string,
  ): Promise<ArrayBuffer> {
    const rawKey = base64ToArrayBuffer(keyBase64);
    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedBuffer);
  }
}

export const e2eeManager = new E2EEManager();
