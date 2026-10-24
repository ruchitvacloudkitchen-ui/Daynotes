/**
 * Client-side AES-256-GCM encryption for cloud privacy.
 */

const VAULT_KEY_STORAGE = 'daynote_vault_passphrase_v1';

export function getOrCreateVaultPassphrase(): string {
  let pass = localStorage.getItem(VAULT_KEY_STORAGE);
  if (!pass) {
    pass = 'daynote-default-privacy-key-2026';
    localStorage.setItem(VAULT_KEY_STORAGE, pass);
  }
  return pass;
}

export function setVaultPassphrase(newPassphrase: string): void {
  const trimmed = newPassphrase.trim();
  if (trimmed.length > 0) {
    localStorage.setItem(VAULT_KEY_STORAGE, trimmed);
  }
}

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesGcmKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedBundle {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string;
  salt: string;
  ct: string;
}

export interface SecretNoteFields {
  title: string;
  content: string;
  attachmentsSummary: string;
  alertMode?: 'voice' | 'text' | 'off';
  importance?: 'red' | 'green' | 'blue' | 'pink' | 'urgent';
  pinCode?: string;
  isPinLocked?: boolean;
}

export async function encryptNoteFields(
  fields: SecretNoteFields,
  passphrase = getOrCreateVaultPassphrase()
): Promise<string> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(passphrase, salt);

  const encoded = new TextEncoder().encode(JSON.stringify(fields));
  const ciphertextBuf = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded
  );

  const bundle: EncryptedBundle = {
    v: 1,
    alg: 'AES-256-GCM',
    iv: bufferToBase64(iv),
    salt: bufferToBase64(salt),
    ct: bufferToBase64(ciphertextBuf),
  };

  return JSON.stringify(bundle);
}

export async function decryptNoteFields(
  encryptedPayload: string,
  passphrase = getOrCreateVaultPassphrase()
): Promise<SecretNoteFields | null> {
  if (!encryptedPayload) return null;
  try {
    const bundle = JSON.parse(encryptedPayload) as EncryptedBundle;
    if (!bundle.iv || !bundle.salt || !bundle.ct) return null;

    const salt = base64ToUint8Array(bundle.salt);
    const iv = base64ToUint8Array(bundle.iv);
    const ciphertext = base64ToUint8Array(bundle.ct);
    const key = await deriveAesGcmKey(passphrase, salt);

    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );

    const decoded = new TextDecoder().decode(decryptedBuf);
    return JSON.parse(decoded) as SecretNoteFields;
  } catch {
    return null;
  }
}
