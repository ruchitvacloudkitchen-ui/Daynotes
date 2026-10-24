/**
 * Offline Storage, IndexedDB Files, and Auto Local Backups.
 */

export type SupportedLanguage = 'en-IN' | 'te-IN' | 'hi-IN';
export type AlertMode = 'voice' | 'text' | 'off';
export type ImportanceColor = 'red' | 'green' | 'blue' | 'pink';

export interface NoteAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'document';
  previewDataUrl: string;
  textSnippet?: string;
  createdAtIso: string;
}

export interface DayNoteItem {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  encryptedPayload: string;
  isEncrypted: boolean;
  language: SupportedLanguage;
  reminderEnabled: boolean;
  alertMode: AlertMode;
  importance: ImportanceColor;
  reminderTime: string;
  reminderAnnounced: boolean;
  isCompleted: boolean;
  pinCode?: string;
  isPinLocked?: boolean;
  attachments: NoteAttachment[];
  createdAtMs: number;
  updatedAtMs: number;
  syncedToCloud?: boolean;
}

export interface LocalBackupSnapshot {
  id: string;
  timestampMs: number;
  label: string;
  noteCount: number;
  sizeBytes: number;
  notes: DayNoteItem[];
}

const LOCAL_NOTES_KEY = 'daynote_offline_notes_v1';
const LOCAL_BACKUPS_KEY = 'daynote_automated_backups_v1';
const IDB_NAME = 'daynote_attachments_idb';
const IDB_STORE = 'files';

function openAttachmentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

export async function saveFullAttachmentToIdb(attachmentId: string, fullDataUrl: string): Promise<void> {
  try {
    const db = await openAttachmentDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(fullDataUrl, attachmentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB save warning:', err);
  }
}

export async function getFullAttachmentFromIdb(attachmentId: string): Promise<string | null> {
  try {
    const db = await openAttachmentDb();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(attachmentId);
      req.onsuccess = () => resolve((req.result as string) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteAttachmentFromIdb(attachmentId: string): Promise<void> {
  try {
    const db = await openAttachmentDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(attachmentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function processUploadedFile(file: File): Promise<NoteAttachment> {
  const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const isImage = file.type.startsWith('image/');

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  await saveFullAttachmentToIdb(id, rawDataUrl);

  let previewDataUrl = '';
  let textSnippet = '';

  if (isImage) {
    previewDataUrl = await createCompactImageThumbnail(rawDataUrl, 180, 0.72);
  } else {
    if (
      file.type.startsWith('text/') ||
      /\.(txt|md|csv|json|log)$/i.test(file.name)
    ) {
      try {
        const text = await file.text();
        textSnippet = text.slice(0, 280);
      } catch {
        textSnippet = '';
      }
    }
    if (rawDataUrl.length < 35000) {
      previewDataUrl = rawDataUrl;
    }
  }

  return {
    id,
    name: file.name.slice(0, 80),
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    kind: isImage ? 'image' : 'document',
    previewDataUrl,
    textSnippet,
    createdAtIso: new Date().toISOString(),
  };
}

function createCompactImageThumbnail(
  srcDataUrl: string,
  maxDim: number,
  quality: number
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(srcDataUrl.slice(0, 30000));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve('');
    img.src = srcDataUrl;
  });
}

export function normalizeColorFolder(raw?: string): ImportanceColor {
  if (raw === 'red' || raw === 'urgent') return 'red';
  if (raw === 'green') return 'green';
  if (raw === 'pink') return 'pink';
  return 'blue';
}

function normalizeLegacyNotes(items: DayNoteItem[]): DayNoteItem[] {
  return items.map((item) => {
    const updatedTitle =
      item.title === 'Morning Standup & Project Priorities'
        ? 'Mornings'
        : item.title === 'సాయంత్రం సరుకులు మరియు మందుల జాబితా (Evening Essentials)'
        ? 'Groceries'
        : item.title === 'बैंक दस्तावेज़ और टैक्स फाइलिंग (Tax & Bank Documents)'
        ? 'Bank Docs'
        : item.title;

    const alertMode: AlertMode =
      item.alertMode || (item.reminderEnabled ? 'voice' : 'off');
    const importance: ImportanceColor = normalizeColorFolder(item.importance);

    return {
      ...item,
      title: updatedTitle,
      alertMode,
      importance,
      reminderEnabled: alertMode !== 'off',
      pinCode: item.pinCode || '',
      isPinLocked: Boolean(item.isPinLocked),
    };
  });
}

export function loadLocalNotes(): DayNoteItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTES_KEY);
    if (!raw) {
      const starter = getStarterNotes();
      saveLocalNotes(starter, false);
      return starter;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = normalizeLegacyNotes(parsed);
    saveLocalNotes(normalized, false);
    return normalized;
  } catch {
    return [];
  }
}

export function saveLocalNotes(notes: DayNoteItem[], triggerAutoBackup = true): void {
  try {
    localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
    if (triggerAutoBackup) {
      createAutomatedBackupSnapshot(notes, 'Auto backup');
    }
  } catch (err) {
    console.warn('Local storage quota warning:', err);
  }
}

export function loadLocalBackups(): LocalBackupSnapshot[] {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createAutomatedBackupSnapshot(
  notes: DayNoteItem[],
  label = 'Auto backup'
): LocalBackupSnapshot[] {
  try {
    const existing = loadLocalBackups();
    const serializedNotes = JSON.stringify(notes);
    if (
      existing.length > 0 &&
      JSON.stringify(existing[0].notes) === serializedNotes &&
      label.startsWith('Auto')
    ) {
      return existing;
    }

    const snapshot: LocalBackupSnapshot = {
      id: `bkp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestampMs: Date.now(),
      label,
      noteCount: notes.length,
      sizeBytes: new Blob([serializedNotes]).size,
      notes: JSON.parse(serializedNotes),
    };

    const updated = [snapshot, ...existing].slice(0, 12);
    localStorage.setItem(LOCAL_BACKUPS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return loadLocalBackups();
  }
}

function getStarterNotes(): DayNoteItem[] {
  const now = Date.now();
  const inTenMinutes = new Date(now + 10 * 60 * 1000);
  const localIso = new Date(inTenMinutes.getTime() - inTenMinutes.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return [
    {
      id: 'note_welcome_en',
      ownerId: 'local_user',
      title: 'Mornings',
      content: 'Check daily tasks, team sync, and client call.',
      encryptedPayload: '',
      isEncrypted: true,
      language: 'en-IN',
      reminderEnabled: true,
      alertMode: 'voice',
      importance: 'red',
      reminderTime: localIso,
      reminderAnnounced: false,
      isCompleted: false,
      pinCode: '',
      isPinLocked: false,
      attachments: [],
      createdAtMs: now - 3600 * 1000,
      updatedAtMs: now - 1800 * 1000,
      syncedToCloud: false,
    },
    {
      id: 'note_welcome_te',
      ownerId: 'local_user',
      title: 'Groceries',
      content: 'పాలు, కూరగాయలు, మందులు తీసుకురావాలి.',
      encryptedPayload: '',
      isEncrypted: true,
      language: 'te-IN',
      reminderEnabled: false,
      alertMode: 'off',
      importance: 'green',
      reminderTime: '',
      reminderAnnounced: false,
      isCompleted: false,
      pinCode: '',
      isPinLocked: false,
      attachments: [],
      createdAtMs: now - 7200 * 1000,
      updatedAtMs: now - 3600 * 1000,
      syncedToCloud: false,
    },
    {
      id: 'note_welcome_hi',
      ownerId: 'local_user',
      title: 'Bank Docs',
      content: 'बैंक स्टेटमेंट और रसीद अपलोड करें।',
      encryptedPayload: '',
      isEncrypted: true,
      language: 'hi-IN',
      reminderEnabled: false,
      alertMode: 'off',
      importance: 'blue',
      reminderTime: '',
      reminderAnnounced: false,
      isCompleted: false,
      pinCode: '',
      isPinLocked: false,
      attachments: [],
      createdAtMs: now - 10800 * 1000,
      updatedAtMs: now - 5400 * 1000,
      syncedToCloud: false,
    },
  ];
}
