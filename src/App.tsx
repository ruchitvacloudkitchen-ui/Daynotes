import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Sun,
  Moon,
  Lock,
  Unlock,
  Volume2,
  Plus,
  Trash2,
  FileText,
  Download,
  Upload,
  RotateCcw,
  Search,
  Cloud,
  CloudOff,
  HardDrive,
  X,
  CheckCircle2,
  Circle,
  Edit3,
  Globe,
  Menu,
  ChevronDown,
  Folder,
  Bell,
  Paperclip,
  Shield,
  Check,
  ScrollText,
  Clock,
  MoreVertical,
} from 'lucide-react';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  OperationType,
  handleFirestoreError,
} from './firebase';
import {
  encryptNoteFields,
  decryptNoteFields,
  getOrCreateVaultPassphrase,
  setVaultPassphrase,
} from './utils/crypto';
import {
  SupportedLanguage,
  AlertMode,
  ImportanceColor,
  NoteAttachment,
  DayNoteItem,
  LocalBackupSnapshot,
  normalizeColorFolder,
  loadLocalNotes,
  saveLocalNotes,
  loadLocalBackups,
  createAutomatedBackupSnapshot,
  processUploadedFile,
  getFullAttachmentFromIdb,
  deleteAttachmentFromIdb,
} from './utils/storage';
import {
  LANGUAGE_OPTIONS,
  getLanguageMeta,
  announceVoiceReminder,
  playReminderChime,
  stopVoiceAnnouncement,
} from './utils/voice';

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type WorkspaceSection = 'notes' | 'reminders' | 'attachments' | 'vault' | 'backups';

const COLOR_FOLDERS: {
  id: ImportanceColor;
  folderName: string;
  bgClass: string;
}[] = [
  {
    id: 'red',
    folderName: 'Red Folder',
    bgClass: 'bg-red-500',
  },
  {
    id: 'green',
    folderName: 'Green Folder',
    bgClass: 'bg-emerald-500',
  },
  {
    id: 'blue',
    folderName: 'Blue Folder',
    bgClass: 'bg-blue-500',
  },
  {
    id: 'pink',
    folderName: 'Pink Folder',
    bgClass: 'bg-pink-500',
  },
];

function GoogleSymbol({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

function formatLocalDatetimeInput(offsetMinutes = 5): string {
  const target = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const local = new Date(target.getTime() - target.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatReadableDateTime(ms: number): string {
  const dt = new Date(ms);
  return dt.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimelineHour(note: DayNoteItem): string {
  if (note.reminderTime) {
    const dt = new Date(note.reminderTime);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  }
  const created = new Date(note.updatedAtMs || note.createdAtMs);
  return created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatReadableTime(isoLocal: string): string {
  if (!isoLocal) return 'No time';
  const dt = new Date(isoLocal);
  if (Number.isNaN(dt.getTime())) return isoLocal;
  return dt.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function App() {
  // --- Dark Mode ---
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('daynote_theme_dark');
    return saved ? saved === 'true' : false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('daynote_theme_dark', String(darkMode));
  }, [darkMode]);

  // --- Navigation, 3-Line Menu & Previous Notes Toggle ---
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('notes');
  const [selectedColorFolder, setSelectedColorFolder] = useState<'all' | ImportanceColor>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [languageFilter, setLanguageFilter] = useState<'all' | SupportedLanguage>('all');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showPreviousNotes, setShowPreviousNotes] = useState(true);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [selectedDayOffset, setSelectedDayOffset] = useState<number>(0);
  const previousNotesRef = useRef<HTMLDivElement | null>(null);
  const composerTitleInputRef = useRef<HTMLInputElement | null>(null);

  // --- Reminder Dropdown State (5min, 15min, 30min, set timer) ---
  const [showComposerReminderMenu, setShowComposerReminderMenu] = useState(false);
  const [showComposerCustomTimer, setShowComposerCustomTimer] = useState(false);
  const [composerReminderLabel, setComposerReminderLabel] = useState<string>('');
  const [openNoteReminderMenuId, setOpenNoteReminderMenuId] = useState<string | null>(null);
  const [customTimerNoteId, setCustomTimerNoteId] = useState<string | null>(null);

  // --- Auth & Sync ---
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncStatusText, setSyncStatusText] = useState<string>('Local Vault');

  // --- Notes & Backups ---
  const [notes, setNotes] = useState<DayNoteItem[]>(() => loadLocalNotes());
  const [backups, setBackups] = useState<LocalBackupSnapshot[]>(() => loadLocalBackups());
  const [vaultPassphrase, setVaultPassphraseState] = useState<string>(() =>
    getOrCreateVaultPassphrase()
  );
  const [passphraseInput, setPassphraseInput] = useState<string>(() =>
    getOrCreateVaultPassphrase()
  );
  const [passphraseSavedNotice, setPassphraseSavedNotice] = useState(false);

  // --- Composer ---
  const [composerTitle, setComposerTitle] = useState('');
  const [composerContent, setComposerContent] = useState('');
  const [composerLanguage, setComposerLanguage] = useState<SupportedLanguage>('en-IN');
  const [composerEncrypted] = useState<boolean>(true);
  const [composerAlertMode, setComposerAlertMode] = useState<AlertMode>('off');
  const [composerImportance, setComposerImportance] = useState<ImportanceColor>('blue');
  const [composerReminderTime, setComposerReminderTime] = useState<string>(() =>
    formatLocalDatetimeInput(5)
  );
  const [composerPinCode, setComposerPinCode] = useState<string>('');
  const [composerAttachments, setComposerAttachments] = useState<NoteAttachment[]>([]);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);

  // --- 4-Digit Number Lock Modal State ---
  const [pinModalState, setPinModalState] = useState<{
    target: 'composer' | string;
    mode: 'set' | 'unlock';
    expectedPin?: string;
  } | null>(null);
  const [pinDigits, setPinDigits] = useState('');
  const [pinError, setPinError] = useState('');

  // --- Speech Dictation ---
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldKeepListeningRef = useRef(false);

  // --- Alerts & Modals ---
  const [activeAlertNote, setActiveAlertNote] = useState<DayNoteItem | null>(null);
  const [speakingNoteId, setSpeakingNoteId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{
    attachment: NoteAttachment;
    fullUrl: string;
  } | null>(null);
  const [inspectingEncryptedNote, setInspectingEncryptedNote] = useState<DayNoteItem | null>(
    null
  );
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // --- 5-Day Schedule Pill Strip (Centered around Today) ---
  const scheduleDays = useMemo(() => {
    const today = new Date();
    const offsets = [-1, 0, 1, 2, 3];
    return offsets.map((offset) => {
      const dt = new Date(today);
      dt.setDate(today.getDate() + offset);
      const dayLabel = dt
        .toLocaleDateString('en-US', { weekday: 'short' })
        .toUpperCase();
      const dateNum = dt.getDate();
      return {
        offset,
        dayLabel,
        dateNum,
        fullDate: dt,
      };
    });
  }, []);

  const currentMonthYear = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + selectedDayOffset);
    return {
      month: base.toLocaleDateString('en-US', { month: 'short' }),
      year: base.getFullYear(),
    };
  }, [selectedDayOffset]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (backups.length === 0 && notes.length > 0) {
      const initial = createAutomatedBackupSnapshot(notes, 'Initial backup');
      setBackups(initial);
    }
  }, [backups.length, notes]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      setSyncStatusText(currentUser ? 'Google Synced' : 'Offline Mode');
    });
    return () => unsub();
  }, []);

  // --- Push Note to Firestore ---
  const pushNoteToFirestore = useCallback(
    async (note: DayNoteItem, currentUser: User) => {
      const path = `notes/${note.id}`;
      try {
        const serializedAttachments = JSON.stringify(note.attachments.slice(0, 20)).slice(
          0,
          240000
        );
        let encryptedPayload = '';
        let storedTitle = note.title.slice(0, 500);
        let storedContent = note.content.slice(0, 20000);
        let storedAttachmentsSummary = serializedAttachments;

        if (note.isEncrypted) {
          encryptedPayload = await encryptNoteFields(
            {
              title: note.title.slice(0, 500),
              content: note.content.slice(0, 20000),
              attachmentsSummary: serializedAttachments,
              alertMode: note.alertMode,
              importance: note.importance,
              pinCode: note.pinCode || '',
              isPinLocked: Boolean(note.isPinLocked),
            },
            vaultPassphrase
          );
          storedTitle = '[Encrypted]';
          storedContent = '[Encrypted]';
          storedAttachmentsSummary = '[]';
        }

        await setDoc(doc(db, 'notes', note.id), {
          ownerId: currentUser.uid,
          title: storedTitle,
          content: storedContent,
          encryptedPayload: encryptedPayload.slice(0, 60000),
          isEncrypted: Boolean(note.isEncrypted),
          language: note.language,
          reminderEnabled: note.alertMode !== 'off',
          reminderTime: (note.reminderTime || '').slice(0, 64),
          reminderAnnounced: Boolean(note.reminderAnnounced),
          isCompleted: Boolean(note.isCompleted),
          attachmentsSummary: storedAttachmentsSummary,
          attachmentCount: Math.min(20, note.attachments.length),
          createdAt: Timestamp.fromMillis(note.createdAtMs || Date.now()),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    [vaultPassphrase]
  );

  // --- Firestore Sync Listener ---
  useEffect(() => {
    if (!authReady || !user) return;

    const q = query(collection(db, 'notes'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        const cloudNotes: DayNoteItem[] = [];
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          let title = String(data.title || '');
          let content = String(data.content || '');
          let attachments: NoteAttachment[] = [];
          let alertMode: AlertMode = data.reminderEnabled ? 'voice' : 'off';
          let importance: ImportanceColor = 'blue';
          let pinCode = '';
          let isPinLocked = false;

          if (data.isEncrypted && data.encryptedPayload) {
            const decrypted = await decryptNoteFields(
              String(data.encryptedPayload),
              vaultPassphrase
            );
            if (decrypted) {
              title = decrypted.title;
              content = decrypted.content;
              if (decrypted.alertMode) alertMode = decrypted.alertMode;
              if (decrypted.importance) {
                importance = normalizeColorFolder(decrypted.importance);
              }
              if (decrypted.pinCode) pinCode = decrypted.pinCode;
              if (typeof decrypted.isPinLocked === 'boolean') {
                isPinLocked = decrypted.isPinLocked;
              }
              try {
                attachments = JSON.parse(decrypted.attachmentsSummary || '[]');
              } catch {
                attachments = [];
              }
            }
          } else if (data.attachmentsSummary) {
            try {
              attachments = JSON.parse(String(data.attachmentsSummary));
            } catch {
              attachments = [];
            }
          }

          const createdAtMs =
            data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const updatedAtMs =
            data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : Date.now();

          cloudNotes.push({
            id: docSnap.id,
            ownerId: String(data.ownerId),
            title: title === 'Morning Standup & Project Priorities' ? 'Mornings' : title,
            content,
            encryptedPayload: String(data.encryptedPayload || ''),
            isEncrypted: Boolean(data.isEncrypted),
            language: (['en-IN', 'te-IN', 'hi-IN'].includes(data.language)
              ? data.language
              : 'en-IN') as SupportedLanguage,
            reminderEnabled: alertMode !== 'off',
            alertMode,
            importance,
            reminderTime: String(data.reminderTime || ''),
            reminderAnnounced: Boolean(data.reminderAnnounced),
            isCompleted: Boolean(data.isCompleted),
            pinCode,
            isPinLocked,
            attachments: Array.isArray(attachments) ? attachments : [],
            createdAtMs,
            updatedAtMs,
            syncedToCloud: true,
          });
        }

        setNotes((prevLocal) => {
          const cloudIds = new Set(cloudNotes.map((n) => n.id));
          const unsyncedLocals = prevLocal.filter(
            (localNote) => !cloudIds.has(localNote.id) && !localNote.syncedToCloud
          );

          unsyncedLocals.forEach((localNote) => {
            const migrated: DayNoteItem = {
              ...localNote,
              ownerId: user.uid,
              syncedToCloud: true,
            };
            pushNoteToFirestore(migrated, user).catch(() => {});
          });

          const merged = [...cloudNotes, ...unsyncedLocals].sort(
            (a, b) => b.updatedAtMs - a.updatedAtMs
          );
          saveLocalNotes(merged, false);
          return merged;
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notes');
      }
    );

    return () => unsub();
  }, [authReady, user, vaultPassphrase, pushNoteToFirestore]);

  const persistNotesUpdate = useCallback(
    async (updatedNotes: DayNoteItem[], changedNote?: DayNoteItem, backupReason?: string) => {
      setNotes(updatedNotes);
      saveLocalNotes(updatedNotes, true);
      const latestBackups = createAutomatedBackupSnapshot(
        updatedNotes,
        backupReason || 'Auto backup'
      );
      setBackups(latestBackups);

      if (user && changedNote) {
        await pushNoteToFirestore(
          { ...changedNote, ownerId: user.uid, syncedToCloud: true },
          user
        );
      }
    },
    [user, pushNoteToFirestore]
  );

  // --- Alert Scheduler (Voice or Text Alert) ---
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();

      setNotes((currentNotes) => {
        let triggeredNote: DayNoteItem | null = null;
        const nextNotes = currentNotes.map((note) => {
          if (
            note.alertMode !== 'off' &&
            !note.reminderAnnounced &&
            note.reminderTime &&
            !note.isCompleted
          ) {
            const targetTime = new Date(note.reminderTime);
            if (!Number.isNaN(targetTime.getTime()) && now >= targetTime) {
              triggeredNote = { ...note, reminderAnnounced: true, updatedAtMs: Date.now() };
              return triggeredNote;
            }
          }
          return note;
        });

        if (triggeredNote) {
          const alertNote = triggeredNote as DayNoteItem;
          saveLocalNotes(nextNotes, false);
          setActiveAlertNote(alertNote);

          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(`Daynote (${alertNote.alertMode.toUpperCase()})`, {
                body: `${alertNote.title}: ${alertNote.content}`,
              });
            } catch {
              // Ignore
            }
          }

          if (alertNote.alertMode === 'voice') {
            setSpeakingNoteId(alertNote.id);
            announceVoiceReminder(
              alertNote.title,
              alertNote.content,
              alertNote.language,
              () => setSpeakingNoteId(alertNote.id),
              () => setSpeakingNoteId(null)
            );
          } else if (alertNote.alertMode === 'text') {
            playReminderChime();
          }

          if (user) {
            pushNoteToFirestore(alertNote, user).catch(() => {});
          }
        }

        return triggeredNote ? nextNotes : currentNotes;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [user, pushNoteToFirestore]);

  // --- Voice Dictation ---
  const stopDictation = useCallback(() => {
    shouldKeepListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
    }
  }, []);

  const startDictation = useCallback(
    (langCode: SupportedLanguage = composerLanguage) => {
      setSpeechError(null);
      const SpeechRec =
        (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
          .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
          .webkitSpeechRecognition;

      if (!SpeechRec) {
        setSpeechError('Mic unavailable in this browser.');
        return;
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
      }

      const recognition = new SpeechRec();
      recognition.lang = langCode;
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalChunk = '';
        let interimChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalChunk += transcript + ' ';
          } else {
            interimChunk += transcript;
          }
        }

        if (finalChunk.trim()) {
          setComposerContent((prev) =>
            prev ? `${prev.trim()} ${finalChunk.trim()}` : finalChunk.trim()
          );
          setComposerTitle((prevTitle) => {
            if (prevTitle.trim()) return prevTitle;
            return finalChunk.trim().split(/\s+/).slice(0, 3).join(' ');
          });
        }
        setInterimTranscript(interimChunk);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech') return;
        shouldKeepListeningRef.current = false;
        setIsListening(false);
        setSpeechError(`Mic paused (${event.error}).`);
      };

      recognition.onend = () => {
        setInterimTranscript('');
        if (shouldKeepListeningRef.current) {
          try {
            recognition.start();
          } catch {
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
      shouldKeepListeningRef.current = true;
      try {
        recognition.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    },
    [composerLanguage]
  );

  const handleSelectDictationLanguage = (lang: SupportedLanguage) => {
    setComposerLanguage(lang);
    setShowLanguageDropdown(false);
    if (isListening) {
      stopDictation();
      setTimeout(() => startDictation(lang), 150);
    }
  };

  // --- Composer Reminder Preset Selection (5min, 15min, 30min, set timer) ---
  const handleSelectComposerReminderPreset = (minutes: number, label: string) => {
    const newTime = formatLocalDatetimeInput(minutes);
    setComposerReminderTime(newTime);
    setComposerReminderLabel(label);
    if (composerAlertMode === 'off') {
      setComposerAlertMode('voice');
    }
    setShowComposerCustomTimer(false);
    setShowComposerReminderMenu(false);
  };

  const handleSelectNoteReminderPreset = async (note: DayNoteItem, minutes: number) => {
    const newTime = formatLocalDatetimeInput(minutes);
    const nextMode: AlertMode = note.alertMode === 'off' ? 'voice' : note.alertMode;
    setOpenNoteReminderMenuId(null);
    setCustomTimerNoteId(null);

    const changed: DayNoteItem = {
      ...note,
      reminderTime: newTime,
      alertMode: nextMode,
      reminderEnabled: true,
      reminderAnnounced: false,
      updatedAtMs: Date.now(),
    };
    const updatedList = notes.map((n) => (n.id === note.id ? changed : n));
    await persistNotesUpdate(updatedList, changed, `Reminder ${minutes}m`);
  };

  // --- 4-Digit PIN Lock Handlers ---
  const handleOpenComposerLock = () => {
    setPinDigits(composerPinCode || '');
    setPinError('');
    setPinModalState({
      target: 'composer',
      mode: 'set',
    });
  };

  const handleClickNoteLock = (note: DayNoteItem) => {
    setPinDigits('');
    setPinError('');
    if (note.isPinLocked && note.pinCode) {
      setPinModalState({
        target: note.id,
        mode: 'unlock',
        expectedPin: note.pinCode,
      });
    } else {
      setPinModalState({
        target: note.id,
        mode: 'set',
      });
    }
  };

  const handleSubmitPinModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinModalState) return;

    if (!/^\d{4}$/.test(pinDigits)) {
      setPinError('Enter 4 digits');
      return;
    }

    if (pinModalState.target === 'composer') {
      setComposerPinCode(pinDigits);
      setPinModalState(null);
      setPinDigits('');
      return;
    }

    const targetNote = notes.find((n) => n.id === pinModalState.target);
    if (!targetNote) {
      setPinModalState(null);
      return;
    }

    if (pinModalState.mode === 'unlock') {
      if (pinDigits !== targetNote.pinCode) {
        setPinError('Wrong 4-digit PIN');
        return;
      }
      const unlocked: DayNoteItem = {
        ...targetNote,
        isPinLocked: false,
        updatedAtMs: Date.now(),
      };
      const updatedList = notes.map((n) => (n.id === targetNote.id ? unlocked : n));
      setPinModalState(null);
      setPinDigits('');
      setExpandedNoteId(targetNote.id);
      await persistNotesUpdate(updatedList, unlocked, 'Unlocked note');
    } else {
      let encryptedPayload = targetNote.encryptedPayload;
      if (targetNote.isEncrypted) {
        encryptedPayload = await encryptNoteFields(
          {
            title: targetNote.title,
            content: targetNote.content,
            attachmentsSummary: JSON.stringify(targetNote.attachments),
            alertMode: targetNote.alertMode,
            importance: targetNote.importance,
            pinCode: pinDigits,
            isPinLocked: true,
          },
          vaultPassphrase
        );
      }

      const locked: DayNoteItem = {
        ...targetNote,
        pinCode: pinDigits,
        isPinLocked: true,
        encryptedPayload,
        updatedAtMs: Date.now(),
      };
      const updatedList = notes.map((n) => (n.id === targetNote.id ? locked : n));
      setPinModalState(null);
      setPinDigits('');
      await persistNotesUpdate(updatedList, locked, 'Locked note with PIN');
    }
  };

  // --- Create Note ---
  const handleCreateNote = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const rawContent = [composerContent.trim(), interimTranscript.trim()]
      .filter(Boolean)
      .join(' ');
    const rawTitle =
      composerTitle.trim() ||
      rawContent.split(/\s+/).slice(0, 3).join(' ') ||
      'Note';

    if (!rawContent && !composerTitle.trim() && composerAttachments.length === 0) {
      return;
    }

    if (isListening) {
      stopDictation();
    }

    const reminderEnabled = composerAlertMode !== 'off';
    if (
      reminderEnabled &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }

    const nowMs = Date.now();
    const newId = `note_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
    const hasPin = /^\d{4}$/.test(composerPinCode);

    let encryptedPayload = '';
    if (composerEncrypted) {
      encryptedPayload = await encryptNoteFields(
        {
          title: rawTitle,
          content: rawContent,
          attachmentsSummary: JSON.stringify(composerAttachments),
          alertMode: composerAlertMode,
          importance: composerImportance,
          pinCode: hasPin ? composerPinCode : '',
          isPinLocked: hasPin,
        },
        vaultPassphrase
      );
    }

    const newNote: DayNoteItem = {
      id: newId,
      ownerId: user?.uid || 'local_user',
      title: rawTitle.slice(0, 500),
      content: rawContent.slice(0, 20000),
      encryptedPayload,
      isEncrypted: composerEncrypted,
      language: composerLanguage,
      reminderEnabled,
      alertMode: composerAlertMode,
      importance: composerImportance,
      reminderTime: reminderEnabled ? composerReminderTime : '',
      reminderAnnounced: false,
      isCompleted: false,
      pinCode: hasPin ? composerPinCode : '',
      isPinLocked: hasPin,
      attachments: composerAttachments,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      syncedToCloud: Boolean(user),
    };

    const updated = [newNote, ...notes];
    setComposerTitle('');
    setComposerContent('');
    setComposerAttachments([]);
    setComposerAlertMode('off');
    setComposerReminderLabel('');
    setShowComposerCustomTimer(false);
    setComposerPinCode('');

    await persistNotesUpdate(updated, newNote, `Saved in ${composerImportance} folder`);
  };

  // --- File Uploads ---
  const handleComposerFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const processed: NoteAttachment[] = [];
    for (let i = 0; i < fileList.length; i++) {
      if (composerAttachments.length + processed.length >= 8) break;
      const att = await processUploadedFile(fileList[i]);
      processed.push(att);
    }
    setComposerAttachments((prev) => [...prev, ...processed]);
    e.target.value = '';
  };

  const handleNoteFilesUpload = async (
    noteId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const targetNote = notes.find((n) => n.id === noteId);
    if (!targetNote) return;

    const added: NoteAttachment[] = [];
    for (let i = 0; i < fileList.length; i++) {
      if (targetNote.attachments.length + added.length >= 12) break;
      const att = await processUploadedFile(fileList[i]);
      added.push(att);
    }

    const updatedAttachments = [...targetNote.attachments, ...added];
    let encryptedPayload = targetNote.encryptedPayload;
    if (targetNote.isEncrypted) {
      encryptedPayload = await encryptNoteFields(
        {
          title: targetNote.title,
          content: targetNote.content,
          attachmentsSummary: JSON.stringify(updatedAttachments),
          alertMode: targetNote.alertMode,
          importance: targetNote.importance,
          pinCode: targetNote.pinCode,
          isPinLocked: targetNote.isPinLocked,
        },
        vaultPassphrase
      );
    }

    const changedNote: DayNoteItem = {
      ...targetNote,
      attachments: updatedAttachments,
      encryptedPayload,
      updatedAtMs: Date.now(),
    };

    const updatedList = notes.map((n) => (n.id === noteId ? changedNote : n));
    e.target.value = '';
    await persistNotesUpdate(updatedList, changedNote, 'Added file');
  };

  const handleOpenAttachment = async (attachment: NoteAttachment) => {
    const fullFromIdb = await getFullAttachmentFromIdb(attachment.id);
    setPreviewAttachment({
      attachment,
      fullUrl: fullFromIdb || attachment.previewDataUrl,
    });
  };

  // --- Note Alert Mode & Color Folder ---
  const handleSetNoteAlertMode = async (note: DayNoteItem, mode: AlertMode) => {
    const nextEnabled = mode !== 'off';
    const defaultTime = note.reminderTime || formatLocalDatetimeInput(5);

    if (nextEnabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    let encryptedPayload = note.encryptedPayload;
    if (note.isEncrypted) {
      encryptedPayload = await encryptNoteFields(
        {
          title: note.title,
          content: note.content,
          attachmentsSummary: JSON.stringify(note.attachments),
          alertMode: mode,
          importance: note.importance,
          pinCode: note.pinCode,
          isPinLocked: note.isPinLocked,
        },
        vaultPassphrase
      );
    }

    const changed: DayNoteItem = {
      ...note,
      alertMode: mode,
      reminderEnabled: nextEnabled,
      reminderTime: nextEnabled ? defaultTime : note.reminderTime,
      reminderAnnounced: false,
      encryptedPayload,
      updatedAtMs: Date.now(),
    };

    const updatedList = notes.map((n) => (n.id === note.id ? changed : n));
    await persistNotesUpdate(updatedList, changed, `Alert ${mode}`);
  };

  const handleSetNoteImportance = async (note: DayNoteItem, importance: ImportanceColor) => {
    let encryptedPayload = note.encryptedPayload;
    if (note.isEncrypted) {
      encryptedPayload = await encryptNoteFields(
        {
          title: note.title,
          content: note.content,
          attachmentsSummary: JSON.stringify(note.attachments),
          alertMode: note.alertMode,
          importance,
          pinCode: note.pinCode,
          isPinLocked: note.isPinLocked,
        },
        vaultPassphrase
      );
    }

    const changed: DayNoteItem = {
      ...note,
      importance,
      encryptedPayload,
      updatedAtMs: Date.now(),
    };

    const updatedList = notes.map((n) => (n.id === note.id ? changed : n));
    await persistNotesUpdate(updatedList, changed, `Moved to ${importance} folder`);
  };

  const handleUpdateNoteReminderTime = async (note: DayNoteItem, newTime: string) => {
    const nextMode: AlertMode =
      note.alertMode === 'off' && newTime ? 'voice' : note.alertMode;
    const changed: DayNoteItem = {
      ...note,
      reminderTime: newTime,
      alertMode: nextMode,
      reminderEnabled: nextMode !== 'off',
      reminderAnnounced: false,
      updatedAtMs: Date.now(),
    };
    const updatedList = notes.map((n) => (n.id === note.id ? changed : n));
    await persistNotesUpdate(updatedList, changed, 'Alert time set');
  };

  const handleSpeakNoteNow = (note: DayNoteItem) => {
    if (note.isPinLocked) return;
    if (speakingNoteId === note.id) {
      stopVoiceAnnouncement();
      setSpeakingNoteId(null);
      return;
    }
    setSpeakingNoteId(note.id);
    announceVoiceReminder(
      note.title,
      note.content,
      note.language,
      () => setSpeakingNoteId(note.id),
      () => setSpeakingNoteId(null)
    );
  };

  const handleToggleCompleted = async (note: DayNoteItem) => {
    const changed: DayNoteItem = {
      ...note,
      isCompleted: !note.isCompleted,
      updatedAtMs: Date.now(),
    };
    const updatedList = notes.map((n) => (n.id === note.id ? changed : n));
    await persistNotesUpdate(updatedList, changed, 'Status updated');
  };

  const handleStartEdit = (note: DayNoteItem) => {
    if (note.isPinLocked) {
      handleClickNoteLock(note);
      return;
    }
    setEditingNoteId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
  };

  const handleSaveEdit = async (note: DayNoteItem) => {
    const cleanTitle = editTitle.trim() || note.title;
    const cleanContent = editContent.trim();
    let encryptedPayload = note.encryptedPayload;
    if (note.isEncrypted) {
      encryptedPayload = await encryptNoteFields(
        {
          title: cleanTitle,
          content: cleanContent,
          attachmentsSummary: JSON.stringify(note.attachments),
          alertMode: note.alertMode,
          importance: note.importance,
          pinCode: note.pinCode,
          isPinLocked: note.isPinLocked,
        },
        vaultPassphrase
      );
    }

    const changed: DayNoteItem = {
      ...note,
      title: cleanTitle.slice(0, 500),
      content: cleanContent.slice(0, 20000),
      encryptedPayload,
      updatedAtMs: Date.now(),
    };
    setEditingNoteId(null);
    const updatedList = notes.map((n) => (n.id === note.id ? changed : n));
    await persistNotesUpdate(updatedList, changed, 'Edited note');
  };

  const handleDeleteNote = async (note: DayNoteItem) => {
    for (const att of note.attachments) {
      await deleteAttachmentFromIdb(att.id);
    }
    const updatedList = notes.filter((n) => n.id !== note.id);
    setNotes(updatedList);
    saveLocalNotes(updatedList, true);
    const snap = createAutomatedBackupSnapshot(updatedList, 'Deleted note');
    setBackups(snap);

    if (user) {
      try {
        await deleteDoc(doc(db, 'notes', note.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `notes/${note.id}`);
      }
    }
  };

  // --- Backups & Vault ---
  const handleManualBackupNow = () => {
    const snap = createAutomatedBackupSnapshot(notes, 'Manual backup');
    setBackups(snap);
  };

  const handleRestoreSnapshot = async (snapshot: LocalBackupSnapshot) => {
    setNotes(snapshot.notes);
    saveLocalNotes(snapshot.notes, false);
    const updatedSnap = createAutomatedBackupSnapshot(snapshot.notes, 'Restored backup');
    setBackups(updatedSnap);

    if (user) {
      for (const note of snapshot.notes) {
        await pushNoteToFirestore({ ...note, ownerId: user.uid, syncedToCloud: true }, user);
      }
    }
  };

  const handleExportBackupFile = () => {
    const exportBundle = {
      app: 'Daynote',
      exportedAt: new Date().toISOString(),
      notes,
    };
    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daynote-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedNotes: DayNoteItem[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.notes)
        ? parsed.notes
        : [];
      if (importedNotes.length > 0) {
        setNotes(importedNotes);
        saveLocalNotes(importedNotes, false);
        const snap = createAutomatedBackupSnapshot(importedNotes, 'Imported file');
        setBackups(snap);
      }
    } catch (err) {
      console.error('Import error:', err);
    }
    e.target.value = '';
  };

  const handleUpdatePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = passphraseInput.trim();
    if (!cleaned) return;
    setVaultPassphrase(cleaned);
    setVaultPassphraseState(cleaned);
    setPassphraseSavedNotice(true);
    setTimeout(() => setPassphraseSavedNotice(false), 2500);

    const reEncrypted: DayNoteItem[] = [];
    for (const n of notes) {
      if (n.isEncrypted) {
        const encryptedPayload = await encryptNoteFields(
          {
            title: n.title,
            content: n.content,
            attachmentsSummary: JSON.stringify(n.attachments),
            alertMode: n.alertMode,
            importance: n.importance,
            pinCode: n.pinCode,
            isPinLocked: n.isPinLocked,
          },
          cleaned
        );
        reEncrypted.push({ ...n, encryptedPayload });
      } else {
        reEncrypted.push(n);
      }
    }
    setNotes(reEncrypted);
    saveLocalNotes(reEncrypted, false);
    if (user) {
      for (const n of reEncrypted) {
        await pushNoteToFirestore(n, user);
      }
    }
  };

  const handleGoogleAuth = async () => {
    if (user) {
      await signOut(auth);
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Sign-in error:', err);
    }
  };

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      if (activeSection === 'reminders' && n.alertMode === 'off') return false;
      if (activeSection === 'attachments' && n.attachments.length === 0) return false;
      if (selectedColorFolder !== 'all' && n.importance !== selectedColorFolder) return false;
      if (languageFilter !== 'all' && n.language !== languageFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = n.title.toLowerCase().includes(q);
        const matchContent = n.content.toLowerCase().includes(q);
        const matchAtt = n.attachments.some((a) => a.name.toLowerCase().includes(q));
        return matchTitle || matchContent || matchAtt;
      }
      return true;
    });
  }, [notes, activeSection, selectedColorFolder, languageFilter, searchQuery]);

  const activeRemindersCount = useMemo(
    () => notes.filter((n) => n.alertMode !== 'off' && !n.isCompleted).length,
    [notes]
  );

  const totalAttachmentsCount = useMemo(
    () => notes.reduce((acc, n) => acc + n.attachments.length, 0),
    [notes]
  );

  const folderCounts = useMemo(() => {
    const counts: Record<ImportanceColor, number> = {
      red: 0,
      green: 0,
      blue: 0,
      pink: 0,
    };
    notes.forEach((n) => {
      const col = normalizeColorFolder(n.importance);
      counts[col] = (counts[col] || 0) + 1;
    });
    return counts;
  }, [notes]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F3F8FF] via-[#E6F1FF] to-[#D6E8FF] dark:from-[#071022] dark:via-[#0B1833] dark:to-[#0F2147] text-slate-900 dark:text-slate-100 transition-colors duration-150 flex flex-col">
      {/* TOP BAR: SIMPLE "DN" ICON + "Daynote" (Only D capital) + TAGLINE + SMALL GOOGLE SYMBOL + 3-LINE MENU */}
      <header className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-white/70 dark:border-slate-800/80 bg-white/70 dark:bg-[#0B1730]/80 backdrop-blur-md sticky top-0 z-30">
        {/* Zone 1: Simple DN Icon + "Daynote" + Tagline */}
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('notes');
              setSelectedColorFolder('all');
              setLanguageFilter('all');
            }}
            className="flex items-center gap-2.5 shrink-0"
          >
            <span className="w-9 h-9 rounded-xl bg-[#1273FF] text-white text-sm font-bold flex items-center justify-center tracking-tight shadow-sm shadow-blue-500/30 shrink-0">
              DN
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-950 dark:text-white whitespace-nowrap">
              Daynote
            </span>
          </a>
          <span className="text-sm font-medium text-slate-500 dark:text-slate-300 truncate hidden sm:inline">
            Time flies! Let’s enjoy the plans ahead today!
          </span>
        </div>

        {/* Zone 2: Active Folder Indicator */}
        <div className="hidden md:flex items-center gap-3 text-sm font-semibold text-[#1273FF] dark:text-blue-400">
          {selectedColorFolder !== 'all' && (
            <span>
              {COLOR_FOLDERS.find((f) => f.id === selectedColorFolder)?.folderName}
            </span>
          )}
        </div>

        {/* Zone 3: Small Google Symbol to Sync Google + Top Right 3-Line Menu Button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleGoogleAuth}
            title={user ? `Google Synced (${user.email}) — Click to Sign Out` : 'Sync with Google'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
              user
                ? 'border-blue-300 bg-blue-50/90 text-[#1273FF] dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                : 'border-white/90 dark:border-slate-700 bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-white shadow-xs'
            }`}
          >
            <GoogleSymbol className="w-4 h-4 shrink-0" />
            <span>{user ? 'Synced' : 'Sync'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowMoreMenu((v) => !v)}
            aria-label="Open More Menu"
            className="p-2 rounded-xl border border-white/90 dark:border-slate-700 bg-white/90 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-white transition-colors shadow-xs cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* TOP-RIGHT 3-LINE MORE MENU DRAWER */}
      {showMoreMenu && (
        <div className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs flex justify-end">
          <div className="w-72 bg-gradient-to-b from-[#F5FAFF] to-[#E6F1FF] dark:from-[#0D1B38] dark:to-[#091326] border-l border-white/80 dark:border-slate-800 h-full p-5 flex flex-col justify-between overflow-y-auto shadow-2xl">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-blue-200/60 dark:border-slate-800">
                <span className="text-base font-bold text-slate-900 dark:text-white">Menu</span>
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(false)}
                  className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 1. Languages */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                  Languages
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setLanguageFilter('all');
                      setShowMoreMenu(false);
                    }}
                    className={`px-3 py-1.5 text-sm font-semibold rounded-xl border transition-colors cursor-pointer ${
                      languageFilter === 'all'
                        ? 'border-[#1273FF] bg-[#1273FF] text-white shadow-sm'
                        : 'border-white/80 bg-white/70 dark:bg-slate-800/80 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    All
                  </button>
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        setComposerLanguage(lang.code);
                        setLanguageFilter(lang.code);
                        setShowMoreMenu(false);
                      }}
                      className={`px-3 py-1.5 text-sm font-semibold rounded-xl border transition-colors cursor-pointer ${
                        languageFilter === lang.code
                          ? 'border-[#1273FF] bg-[#1273FF] text-white shadow-sm'
                          : 'border-white/80 bg-white/70 dark:bg-slate-800/80 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Color Folders (Red, Green, Blue, Pink) */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                  Color Folders
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('notes');
                    setSelectedColorFolder('all');
                    setShowMoreMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                    activeSection === 'notes' && selectedColorFolder === 'all'
                      ? 'bg-[#1273FF] text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Folder className="w-4 h-4" />
                    <span>All Notes</span>
                  </span>
                  <span className="font-mono tabular-nums">{notes.length}</span>
                </button>

                {COLOR_FOLDERS.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      setActiveSection('notes');
                      setSelectedColorFolder(folder.id);
                      setShowMoreMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                      activeSection === 'notes' && selectedColorFolder === folder.id
                        ? 'bg-[#1273FF] text-white shadow-sm'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className={`w-3 h-3 rounded-full ${folder.bgClass}`} />
                      <span>{folder.folderName}</span>
                    </span>
                    <span className="font-mono tabular-nums">{folderCounts[folder.id]}</span>
                  </button>
                ))}
              </div>

              {/* 3. Alerts, Files, Vault, Backups */}
              <div className="space-y-1.5 pt-2 border-t border-blue-200/60 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                  Options
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('reminders');
                    setSelectedColorFolder('all');
                    setShowMoreMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                    activeSection === 'reminders'
                      ? 'bg-[#1273FF] text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    <span>Alerts</span>
                  </span>
                  <span className="font-mono tabular-nums">{activeRemindersCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('attachments');
                    setSelectedColorFolder('all');
                    setShowMoreMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                    activeSection === 'attachments'
                      ? 'bg-[#1273FF] text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Paperclip className="w-4 h-4" />
                    <span>Files</span>
                  </span>
                  <span className="font-mono tabular-nums">{totalAttachmentsCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('vault');
                    setShowMoreMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                    activeSection === 'vault'
                      ? 'bg-[#1273FF] text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    <span>Vault</span>
                  </span>
                  <span className="text-xs font-mono">AES</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('backups');
                    setShowMoreMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
                    activeSection === 'backups'
                      ? 'bg-[#1273FF] text-white shadow-sm'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    <span>Backups</span>
                  </span>
                  <span className="font-mono tabular-nums">{backups.length}</span>
                </button>
              </div>
            </div>

            {/* Menu Footer */}
            <div className="pt-3 border-t border-blue-200/60 dark:border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDarkMode((d) => !d)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-white/80 dark:border-slate-700 rounded-xl bg-white/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  {darkMode ? (
                    <>
                      <Sun className="w-3.5 h-3.5 text-amber-400" />
                      <span>Light</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-3.5 h-3.5 text-[#1273FF]" />
                      <span>Night</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleGoogleAuth}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-white/80 dark:border-slate-700 rounded-xl bg-white/80 dark:bg-slate-800 text-slate-800 dark:text-slate-100 cursor-pointer"
                >
                  <GoogleSymbol className="w-3.5 h-3.5" />
                  <span>{user ? 'Sign Out' : 'Google Sync'}</span>
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  {isOnline ? (
                    <Cloud className="w-3.5 h-3.5 text-[#1273FF]" />
                  ) : (
                    <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                  )}
                  {syncStatusText}
                </span>
                <span>AES-256</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE ALERT BANNER */}
      {activeAlertNote && (
        <div className="bg-[#1273FF] text-white px-5 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-5 h-5 text-white shrink-0" />
            <div>
              <p className="text-sm font-bold">
                Alert ({activeAlertNote.alertMode}): {activeAlertNote.title}
              </p>
              <p className="text-xs text-blue-100">
                {activeAlertNote.content}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleSpeakNoteNow(activeAlertNote)}
              className="px-3 py-1 text-xs font-semibold bg-white text-[#1273FF] rounded-lg cursor-pointer"
            >
              Speak
            </button>
            <button
              type="button"
              onClick={() => {
                stopVoiceAnnouncement();
                setSpeakingNoteId(null);
                setActiveAlertNote(null);
              }}
              className="px-3 py-1 text-xs font-semibold border border-white/60 text-white rounded-lg cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* MAIN VIEWPORT */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24">
        {activeSection === 'vault' || activeSection === 'backups' ? (
          /* VAULT & BACKUPS VIEW */
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-blue-200/60 dark:border-slate-800">
              <h1 className="text-xl font-bold text-slate-950 dark:text-white">
                {activeSection === 'vault' ? 'Vault' : 'Backups'}
              </h1>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveSection('notes')}
                  className="px-3 py-1.5 text-xs font-semibold border border-white/80 dark:border-slate-700 rounded-xl bg-white/80 dark:bg-slate-800 cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleManualBackupNow}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#1273FF] text-white rounded-xl cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Backup</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportBackupFile}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-white/80 dark:border-slate-700 rounded-xl bg-white/80 dark:bg-slate-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
                <label className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-white/80 dark:border-slate-700 rounded-xl bg-white/80 dark:bg-slate-800 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportBackupFile}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <section className="p-5 schedule-card-light backdrop-blur-md border border-white/90 dark:border-slate-800 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-950 dark:text-white">
                  Vault Key
                </h2>
                <span className="text-xs font-mono text-[#1273FF] dark:text-blue-400 font-semibold">
                  AES-256
                </span>
              </div>
              <form
                onSubmit={handleUpdatePassphrase}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={passphraseInput}
                  onChange={(e) => setPassphraseInput(e.target.value)}
                  placeholder="Key..."
                  className="flex-1 px-3.5 py-2 text-sm font-mono bg-white/90 dark:bg-slate-900 border border-blue-200 dark:border-slate-700 rounded-xl focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-[#1273FF] text-white rounded-xl cursor-pointer"
                >
                  Save
                </button>
                {passphraseSavedNotice && (
                  <span className="text-xs text-emerald-600 font-semibold">Saved</span>
                )}
              </form>
            </section>

            <section className="schedule-card-light backdrop-blur-md border border-white/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-blue-100/80 dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-950 dark:text-white">Backups</h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {backups.length} saved
                </span>
              </div>
              <div className="divide-y divide-blue-100/60 dark:divide-slate-800">
                {backups.map((snap) => (
                  <div
                    key={snap.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                        {snap.label}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono tabular-nums">
                        <span>{new Date(snap.timestampMs).toLocaleTimeString()}</span>
                        <span>·</span>
                        <span>{snap.noteCount} notes</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreSnapshot(snap)}
                      className="px-3 py-1 text-xs font-semibold border border-blue-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800 rounded-xl cursor-pointer"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          /* HOME SCHEDULE & NOTE INTERFACE MATCHING REFERENCE SCREENSHOT */
          <div className="space-y-6">
            {/* SCHEDULE HEADER: MONTH + YEAR & "Add New Note" ACTION + VERTICAL PILL DATE SCROLLER */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedDayOffset(0)}
                  className="flex items-center gap-2 text-2xl sm:text-3xl tracking-tight text-slate-950 dark:text-white cursor-pointer"
                >
                  <span className="font-extrabold">{currentMonthYear.month}</span>
                  <span className="font-light text-slate-700 dark:text-slate-300">
                    {currentMonthYear.year}
                  </span>
                  <ChevronDown className="w-5 h-5 text-slate-700 dark:text-slate-300 mt-0.5" />
                </button>

                <button
                  type="button"
                  onClick={() => composerTitleInputRef.current?.focus()}
                  className="text-sm sm:text-base font-bold text-[#1273FF] dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Add New Note
                </button>
              </div>

              {/* 5 Vertical Capsule Date Pills (SUN 19, MON 20 active blue, TUE 21, WED 22, THU 23) */}
              <div className="grid grid-cols-5 gap-2.5 sm:gap-3.5 pt-1">
                {scheduleDays.map((d) => {
                  const isSelected = selectedDayOffset === d.offset;
                  return (
                    <button
                      key={d.offset}
                      type="button"
                      onClick={() => setSelectedDayOffset(d.offset)}
                      className={`flex flex-col items-center justify-center py-4 sm:py-5 rounded-[34px] transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#1273FF] text-white shadow-lg shadow-blue-500/30'
                          : 'bg-white/65 dark:bg-slate-800/70 border border-white/90 dark:border-slate-700/80 text-slate-800 dark:text-slate-200 hover:bg-white/90'
                      }`}
                    >
                      <span
                        className={`text-xs font-semibold tracking-wider ${
                          isSelected
                            ? 'text-white/95'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {d.dayLabel}
                      </span>
                      <span className="text-xl sm:text-2xl font-bold mt-2 tabular-nums">
                        {d.dateNum}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* NOTE COMPOSER CARD IN SOFT SKY-BLUE / TRANSLUCENT WHITE STYLE */}
            <section
              aria-label="New Note"
              className="schedule-card-light backdrop-blur-md border border-white/90 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-[0_8px_30px_rgba(18,115,255,0.06)]"
            >
              {/* Top Row: Language Button + Lock Symbol Beside Language Box + Speak Button */}
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-blue-100/80 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  {/* Language Dropdown Button */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowLanguageDropdown((v) => !v)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-blue-100 dark:border-slate-700 rounded-xl bg-white/90 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-white transition-colors cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 text-[#1273FF]" />
                      <span>Language</span>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>

                    {showLanguageDropdown && (
                      <div className="absolute left-0 mt-1.5 w-36 bg-white dark:bg-slate-900 border border-blue-100 dark:border-slate-700 rounded-xl shadow-lg py-1 z-20">
                        {LANGUAGE_OPTIONS.map((lang) => {
                          const active = composerLanguage === lang.code;
                          return (
                            <button
                              key={lang.code}
                              type="button"
                              onClick={() => handleSelectDictationLanguage(lang.code)}
                              className={`w-full text-left px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                                active
                                  ? 'bg-blue-50 text-[#1273FF] dark:bg-blue-950/60 dark:text-blue-300 font-semibold'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {lang.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Small Lock Symbol Beside Language Box (4-Digit Number Lock) */}
                  <button
                    type="button"
                    onClick={handleOpenComposerLock}
                    title={composerPinCode ? `PIN Set (${composerPinCode})` : 'Set 4-Digit Lock'}
                    className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold border rounded-xl transition-colors cursor-pointer ${
                      composerPinCode
                        ? 'bg-[#1273FF] text-white border-[#1273FF]'
                        : 'bg-white/90 dark:bg-slate-800 border-blue-100 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    {composerPinCode && <span className="font-mono text-xs">••••</span>}
                  </button>
                </div>

                {/* Speak Dictation Button */}
                <button
                  type="button"
                  onClick={() => (isListening ? stopDictation() : startDictation())}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs ${
                    isListening
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-[#1273FF] hover:bg-blue-600 text-white'
                  }`}
                >
                  {isListening ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      <span>Speak</span>
                    </>
                  )}
                </button>
              </div>

              {isListening && (
                <div className="px-3.5 py-2 rounded-xl bg-blue-50/90 dark:bg-blue-950/50 border border-blue-200 text-xs font-medium text-[#1273FF] dark:text-blue-200">
                  Speaking... {interimTranscript && <em>“{interimTranscript}”</em>}
                </div>
              )}

              {speechError && (
                <div className="px-3.5 py-2 rounded-xl bg-red-50 dark:bg-amber-950/40 border border-red-200 flex items-center justify-between text-xs text-red-900 dark:text-amber-200">
                  <span>{speechError}</span>
                  <button
                    type="button"
                    onClick={() => setSpeechError(null)}
                    className="underline cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Note Inputs with Much Bigger "Note" Entry Box */}
              <form onSubmit={handleCreateNote} className="space-y-3.5">
                <input
                  ref={composerTitleInputRef}
                  type="text"
                  value={composerTitle}
                  onChange={(e) => setComposerTitle(e.target.value)}
                  placeholder="Title..."
                  className="w-full px-4 py-2.5 text-base font-bold bg-white/90 dark:bg-slate-900/90 border border-blue-100 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#1273FF] text-slate-900 dark:text-white"
                />

                <textarea
                  rows={7}
                  value={
                    interimTranscript
                      ? `${composerContent} ${interimTranscript}`.trim()
                      : composerContent
                  }
                  onChange={(e) => setComposerContent(e.target.value)}
                  placeholder="Note..."
                  className="w-full min-h-[180px] px-4 py-3 text-base leading-relaxed bg-white/90 dark:bg-slate-900/90 border border-blue-100 dark:border-slate-700 rounded-xl focus:outline-none focus:border-[#1273FF] text-slate-900 dark:text-white resize-y"
                />

                {/* Controls Row: Constant-Size Round Color Buttons (With Right Tick Mark Only) + Reminder Button + Alert */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  {/* Small Round Color Buttons — Constant Size, Only Right Tick Mark Changes */}
                  <div className="flex items-center gap-2">
                    {COLOR_FOLDERS.map((col) => {
                      const active = composerImportance === col.id;
                      return (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => setComposerImportance(col.id)}
                          aria-label={col.folderName}
                          title={col.folderName}
                          className={`w-4 h-4 rounded-full ${col.bgClass} flex items-center justify-center cursor-pointer`}
                        >
                          {active && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Reminder Button (5min, 15min, 30min, set timer) + Alert (voice, text, off) */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowComposerReminderMenu((v) => !v)}
                        className="flex items-center gap-1 px-3 py-1 text-xs font-semibold border border-blue-100 dark:border-slate-700 rounded-xl bg-white/90 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-white cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5 text-[#1273FF]" />
                        <span>
                          Reminder{composerReminderLabel ? `: ${composerReminderLabel}` : ''}
                        </span>
                        <ChevronDown className="w-3 h-3" />
                      </button>

                      {showComposerReminderMenu && (
                        <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-slate-900 border border-blue-100 dark:border-slate-700 rounded-xl shadow-lg py-1 z-20">
                          <button
                            type="button"
                            onClick={() => handleSelectComposerReminderPreset(5, '5min')}
                            className="w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            5min
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectComposerReminderPreset(15, '15min')}
                            className="w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            15min
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectComposerReminderPreset(30, '30min')}
                            className="w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            30min
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowComposerCustomTimer(true);
                              setComposerReminderLabel('Custom');
                              if (composerAlertMode === 'off') {
                                setComposerAlertMode('voice');
                              }
                              setShowComposerReminderMenu(false);
                            }}
                            className="w-full text-left px-3 py-1.5 text-xs font-semibold text-[#1273FF] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer border-t border-blue-50 dark:border-slate-800"
                          >
                            Set timer
                          </button>
                        </div>
                      )}
                    </div>

                    <span className="text-xs font-semibold text-slate-500">Alert</span>
                    <div className="inline-flex items-center p-0.5 bg-blue-50/80 dark:bg-slate-800 rounded-xl border border-blue-100 dark:border-slate-700 gap-0.5">
                      {(['voice', 'text', 'off'] as AlertMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setComposerAlertMode(mode)}
                          className={`px-2 py-0.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            composerAlertMode === mode
                              ? 'bg-[#1273FF] text-white'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>

                    {showComposerCustomTimer && composerAlertMode !== 'off' && (
                      <input
                        type="datetime-local"
                        value={composerReminderTime}
                        onChange={(e) => setComposerReminderTime(e.target.value)}
                        className="px-2.5 py-1 text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-700 rounded-xl focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                {/* Bottom Row of Note Box: Small File Boxes + Save Button */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-blue-100/80 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {composerAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="relative group w-8 h-8 rounded-lg border border-blue-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0"
                        title={att.name}
                      >
                        {att.kind === 'image' && att.previewDataUrl ? (
                          <img
                            src={att.previewDataUrl}
                            alt={att.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-[#1273FF]" />
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setComposerAttachments((prev) =>
                              prev.filter((item) => item.id !== att.id)
                            )
                          }
                          className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-slate-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => composerFileInputRef.current?.click()}
                      className="w-8 h-8 rounded-lg border border-dashed border-blue-300 dark:border-slate-700 hover:border-[#1273FF] bg-white/80 dark:bg-slate-900/60 flex flex-col items-center justify-center text-slate-500 transition-colors shrink-0 cursor-pointer"
                      title="Add file"
                    >
                      <Plus className="w-3 h-3 text-[#1273FF]" />
                      <span className="text-[9px] font-semibold">File</span>
                    </button>
                    <input
                      ref={composerFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.txt,.doc,.docx,.csv,.md,.json"
                      onChange={handleComposerFilesUpload}
                      className="hidden"
                    />
                  </div>

                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-bold bg-[#1273FF] hover:bg-blue-600 text-white rounded-xl shadow-sm shadow-blue-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </form>
            </section>

            {/* ACTIVE FOLDER FILTER BAR */}
            {(selectedColorFolder !== 'all' ||
              languageFilter !== 'all' ||
              activeSection !== 'notes') && (
              <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-white/75 dark:bg-slate-800/80 border border-white/90 dark:border-slate-700 text-xs">
                <div className="flex items-center gap-2 font-semibold">
                  {selectedColorFolder !== 'all' && (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`w-3 h-3 rounded-full ${
                          COLOR_FOLDERS.find((c) => c.id === selectedColorFolder)?.bgClass
                        }`}
                      />
                      <span>
                        {COLOR_FOLDERS.find((c) => c.id === selectedColorFolder)?.folderName}
                      </span>
                    </span>
                  )}
                  {languageFilter !== 'all' && (
                    <span>Language: {getLanguageMeta(languageFilter).label}</span>
                  )}
                  {activeSection === 'reminders' && <span>Alerts</span>}
                  {activeSection === 'attachments' && <span>Files</span>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedColorFolder('all');
                    setLanguageFilter('all');
                    setActiveSection('notes');
                  }}
                  className="text-[#1273FF] dark:text-blue-400 font-bold underline cursor-pointer"
                >
                  All Notes
                </button>
              </div>
            )}

            {/* PREVIOUS NOTES SCHEDULE TIMELINE SECTION (MATCHING SCREENSHOT TIMELINE & CARDS) */}
            {showPreviousNotes && (
              <div ref={previousNotesRef} className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search schedule notes..."
                      className="w-full pl-9 pr-3.5 py-2 text-sm bg-white/75 dark:bg-slate-900/80 border border-white/90 dark:border-slate-800 rounded-2xl focus:outline-none focus:border-[#1273FF]"
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-500 font-mono tabular-nums shrink-0">
                    {filteredNotes.length} notes
                  </span>
                </div>

                {filteredNotes.length === 0 ? (
                  <div className="p-8 schedule-card-light border border-white/90 dark:border-slate-800 rounded-2xl text-center">
                    <p className="text-sm font-medium text-slate-500">No notes</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredNotes.map((note, idx) => {
                      const isExpanded = expandedNoteId === note.id;
                      const isBlueFeatured = isExpanded || idx === filteredNotes.length - 1;
                      const isSpeakingThis = speakingNoteId === note.id;
                      const isEditingThis = editingNoteId === note.id;
                      const langMeta = getLanguageMeta(note.language);
                      const timeLabel = formatTimelineHour(note);

                      return (
                        <React.Fragment key={note.id}>
                          {/* Current Time Blue Line Divider before the featured blue card (just like 13:00 in screenshot) */}
                          {idx === filteredNotes.length - 1 && filteredNotes.length > 1 && (
                            <div className="flex items-center gap-3 py-1">
                              <span className="w-12 text-xs font-semibold text-slate-400 dark:text-slate-500 font-mono tabular-nums text-right">
                                13:00
                              </span>
                              <div className="flex-1 flex items-center">
                                <span className="w-2.5 h-2.5 rounded-full bg-[#1273FF] shrink-0" />
                                <div className="h-[2px] flex-1 bg-gradient-to-r from-[#1273FF] to-[#1273FF]/30" />
                              </div>
                            </div>
                          )}

                          <div className="flex items-start gap-3 sm:gap-4">
                            {/* Left Time Column (09:00, 11:00, 14:00) */}
                            <div className="w-12 pt-3 text-right shrink-0">
                              <span className="text-xs sm:text-sm font-semibold text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                                {timeLabel}
                              </span>
                            </div>

                            {/* Right Schedule Note Card */}
                            <article
                              className={`flex-1 rounded-2xl px-5 py-4 transition-colors ${
                                isBlueFeatured
                                  ? 'schedule-card-blue text-white shadow-lg shadow-blue-500/25 border border-blue-400/40'
                                  : 'schedule-card-light text-slate-900 dark:text-white border border-white/95 dark:border-slate-800 shadow-[0_4px_20px_rgba(18,115,255,0.05)]'
                              }`}
                            >
                              {/* Heading Row: Uses Note Title for Note Name */}
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedNoteId((prev) =>
                                      prev === note.id ? null : note.id
                                    )
                                  }
                                  className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer"
                                >
                                  <span
                                    className={`text-base font-bold truncate ${
                                      isBlueFeatured
                                        ? 'text-white'
                                        : 'text-slate-900 dark:text-white'
                                    }`}
                                  >
                                    {note.title}
                                  </span>
                                  {note.isPinLocked && (
                                    <Lock
                                      className={`w-3.5 h-3.5 shrink-0 ${
                                        isBlueFeatured ? 'text-white/90' : 'text-slate-500'
                                      }`}
                                    />
                                  )}
                                </button>

                                <div className="flex items-center gap-2 shrink-0">
                                  {/* Round Color Buttons — Constant Size, Only Right Tick Mark Changes */}
                                  <div className="flex items-center gap-1.5 bg-black/10 dark:bg-black/25 px-2 py-1 rounded-full">
                                    {COLOR_FOLDERS.map((col) => {
                                      const active = note.importance === col.id;
                                      return (
                                        <button
                                          key={col.id}
                                          type="button"
                                          onClick={() => handleSetNoteImportance(note, col.id)}
                                          aria-label={col.folderName}
                                          title={col.folderName}
                                          className={`w-3.5 h-3.5 rounded-full ${col.bgClass} flex items-center justify-center cursor-pointer`}
                                        >
                                          {active && (
                                            <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  {/* Language Tag + Small Lock Symbol Beside It */}
                                  <span
                                    className={`px-2 py-0.5 text-xs font-semibold rounded-lg ${
                                      isBlueFeatured
                                        ? 'bg-white/20 text-white'
                                        : 'bg-blue-50 dark:bg-slate-800 text-[#1273FF] dark:text-blue-300'
                                    }`}
                                  >
                                    {langMeta.label}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleClickNoteLock(note)}
                                    title={
                                      note.isPinLocked ? 'Unlock 4-digit PIN' : 'Set 4-digit PIN'
                                    }
                                    className={`p-1 cursor-pointer ${
                                      isBlueFeatured
                                        ? 'text-white/90 hover:text-white'
                                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                  >
                                    {note.isPinLocked ? (
                                      <Lock className="w-3.5 h-3.5" />
                                    ) : (
                                      <Unlock className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedNoteId((prev) =>
                                        prev === note.id ? null : note.id
                                      )
                                    }
                                    className={`p-1 cursor-pointer ${
                                      isBlueFeatured ? 'text-white/90' : 'text-slate-400'
                                    }`}
                                    aria-label="Toggle note details"
                                  >
                                    <MoreVertical className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Expanded Note Content (when user clicks the note title) */}
                              {isExpanded && (
                                <div
                                  className={`mt-3 pt-3 border-t space-y-3 ${
                                    isBlueFeatured
                                      ? 'border-white/20'
                                      : 'border-blue-100/80 dark:border-slate-800'
                                  }`}
                                >
                                  {note.isPinLocked ? (
                                    <div className="py-1 flex items-center justify-between">
                                      <span
                                        className={`text-xs font-mono ${
                                          isBlueFeatured ? 'text-white/90' : 'text-slate-500'
                                        }`}
                                      >
                                        •••• Locked Note
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleClickNoteLock(note)}
                                        className={`px-3 py-1 text-xs font-bold rounded-xl cursor-pointer ${
                                          isBlueFeatured
                                            ? 'bg-white text-[#1273FF]'
                                            : 'bg-[#1273FF] text-white'
                                        }`}
                                      >
                                        Unlock
                                      </button>
                                    </div>
                                  ) : isEditingThis ? (
                                    <div className="space-y-2 text-slate-900">
                                      <input
                                        type="text"
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm font-semibold bg-white dark:bg-slate-900 dark:text-white border border-blue-200 rounded-xl"
                                      />
                                      <textarea
                                        rows={3}
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 dark:text-white border border-blue-200 rounded-xl resize-none"
                                      />
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleSaveEdit(note)}
                                          className="px-3 py-1 text-xs font-bold bg-white text-[#1273FF] rounded-xl cursor-pointer shadow-xs"
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingNoteId(null)}
                                          className="px-3 py-1 text-xs font-semibold border border-white/60 text-white rounded-xl cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      <div className="flex items-start gap-2.5">
                                        <button
                                          type="button"
                                          onClick={() => handleToggleCompleted(note)}
                                          className={`mt-0.5 cursor-pointer ${
                                            isBlueFeatured
                                              ? 'text-white/90'
                                              : 'text-slate-400 hover:text-[#1273FF]'
                                          }`}
                                        >
                                          {note.isCompleted ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                                          ) : (
                                            <Circle className="w-4 h-4" />
                                          )}
                                        </button>
                                        <div className="flex-1 min-w-0">
                                          <p
                                            className={`text-sm whitespace-pre-wrap leading-relaxed ${
                                              isBlueFeatured
                                                ? 'text-white/95'
                                                : 'text-slate-700 dark:text-slate-300'
                                            }`}
                                          >
                                            {note.content}
                                          </p>
                                        </div>
                                      </div>

                                      {/* Reminder Button (5min, 15min, 30min, set timer) + Alert + Small File Boxes */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          {note.attachments.map((att) => (
                                            <div
                                              key={att.id}
                                              className="relative group w-8 h-8 rounded-full border-2 border-white dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0 shadow-xs"
                                            >
                                              <button
                                                type="button"
                                                onClick={() => handleOpenAttachment(att)}
                                                className="w-full h-full flex items-center justify-center cursor-pointer"
                                                title={att.name}
                                              >
                                                {att.kind === 'image' && att.previewDataUrl ? (
                                                  <img
                                                    src={att.previewDataUrl}
                                                    alt={att.name}
                                                    referrerPolicy="no-referrer"
                                                    className="w-full h-full object-cover"
                                                  />
                                                ) : (
                                                  <FileText className="w-3.5 h-3.5 text-[#1273FF]" />
                                                )}
                                              </button>
                                            </div>
                                          ))}
                                          <label
                                            title="Add file"
                                            className={`w-8 h-8 rounded-full border border-dashed flex items-center justify-center cursor-pointer ${
                                              isBlueFeatured
                                                ? 'border-white/70 text-white'
                                                : 'border-blue-300 text-[#1273FF]'
                                            }`}
                                          >
                                            <Plus className="w-3.5 h-3.5" />
                                            <input
                                              type="file"
                                              multiple
                                              accept="image/*,.pdf,.txt,.doc,.docx,.csv,.md,.json"
                                              onChange={(e) => handleNoteFilesUpload(note.id, e)}
                                              className="hidden"
                                            />
                                          </label>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                          {/* Reminder Button on Note */}
                                          <div className="relative">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOpenNoteReminderMenuId((prev) =>
                                                  prev === note.id ? null : note.id
                                                )
                                              }
                                              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-xl cursor-pointer ${
                                                isBlueFeatured
                                                  ? 'bg-white/20 text-white'
                                                  : 'bg-white dark:bg-slate-800 border border-blue-100 text-slate-700 dark:text-slate-200'
                                              }`}
                                            >
                                              <Clock className="w-3 h-3" />
                                              <span>Reminder</span>
                                            </button>

                                            {openNoteReminderMenuId === note.id && (
                                              <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-blue-100 dark:border-slate-700 rounded-xl shadow-lg py-1 z-20">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleSelectNoteReminderPreset(note, 5)
                                                  }
                                                  className="w-full text-left px-3 py-1 text-xs hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                                                >
                                                  5min
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleSelectNoteReminderPreset(note, 15)
                                                  }
                                                  className="w-full text-left px-3 py-1 text-xs hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                                                >
                                                  15min
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleSelectNoteReminderPreset(note, 30)
                                                  }
                                                  className="w-full text-left px-3 py-1 text-xs hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer"
                                                >
                                                  30min
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setCustomTimerNoteId(note.id);
                                                    setOpenNoteReminderMenuId(null);
                                                  }}
                                                  className="w-full text-left px-3 py-1 text-xs font-semibold text-[#1273FF] hover:bg-blue-50 dark:hover:bg-slate-800 cursor-pointer border-t border-blue-50 dark:border-slate-800"
                                                >
                                                  Set timer
                                                </button>
                                              </div>
                                            )}
                                          </div>

                                          {/* Small Alert (voice, text, off) */}
                                          <div
                                            className={`inline-flex items-center p-0.5 rounded-xl gap-0.5 ${
                                              isBlueFeatured
                                                ? 'bg-white/20'
                                                : 'bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700'
                                            }`}
                                          >
                                            {(['voice', 'text', 'off'] as AlertMode[]).map(
                                              (mode) => (
                                                <button
                                                  key={mode}
                                                  type="button"
                                                  onClick={() => handleSetNoteAlertMode(note, mode)}
                                                  className={`px-2 py-0.5 text-xs font-semibold rounded-lg cursor-pointer ${
                                                    note.alertMode === mode
                                                      ? isBlueFeatured
                                                        ? 'bg-white text-[#1273FF]'
                                                        : 'bg-[#1273FF] text-white'
                                                      : isBlueFeatured
                                                      ? 'text-white/80'
                                                      : 'text-slate-600 dark:text-slate-400'
                                                  }`}
                                                >
                                                  {mode}
                                                </button>
                                              )
                                            )}
                                          </div>

                                          {customTimerNoteId === note.id && (
                                            <input
                                              type="datetime-local"
                                              value={note.reminderTime}
                                              onChange={(e) =>
                                                handleUpdateNoteReminderTime(note, e.target.value)
                                              }
                                              className="px-2 py-0.5 text-xs font-mono text-slate-900 bg-white border border-blue-200 rounded-lg"
                                            />
                                          )}

                                          <button
                                            type="button"
                                            onClick={() => handleSpeakNoteNow(note)}
                                            className={`px-2.5 py-0.5 text-xs font-semibold rounded-lg cursor-pointer ${
                                              isBlueFeatured
                                                ? 'bg-white/20 text-white'
                                                : 'border border-blue-200 text-[#1273FF]'
                                            }`}
                                          >
                                            {isSpeakingThis ? 'Stop' : 'Voice'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleStartEdit(note)}
                                            className={`p-1 cursor-pointer ${
                                              isBlueFeatured
                                                ? 'text-white/90 hover:text-white'
                                                : 'text-slate-500 hover:text-slate-900'
                                            }`}
                                          >
                                            <Edit3 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteNote(note)}
                                            className={`p-1 cursor-pointer ${
                                              isBlueFeatured
                                                ? 'text-white/90 hover:text-red-200'
                                                : 'text-slate-500 hover:text-red-600'
                                            }`}
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Bottom of Note: Small Date */}
                              <div
                                className={`pt-2 flex items-center justify-between text-xs font-mono tabular-nums ${
                                  isBlueFeatured ? 'text-blue-100' : 'text-slate-400'
                                }`}
                              >
                                <span>{formatReadableDateTime(note.updatedAtMs)}</span>
                                {note.alertMode !== 'off' && note.reminderTime && (
                                  <span>Reminder: {formatReadableTime(note.reminderTime)}</span>
                                )}
                              </div>
                            </article>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* BOTTOM PAPER SYMBOL ICON FOR PREVIOUS NOTES */}
      <footer className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
        <button
          type="button"
          onClick={() => {
            setActiveSection('notes');
            setShowPreviousNotes((prev) => {
              const next = !prev;
              if (next) {
                setTimeout(() => {
                  previousNotesRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 80);
              }
              return next;
            });
          }}
          title="Previous Notes"
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/90 dark:border-slate-700 bg-[#1273FF] text-white shadow-lg shadow-blue-500/30 hover:bg-blue-600 transition-colors cursor-pointer"
        >
          <ScrollText className="w-4 h-4" />
          <span className="text-xs font-bold">Notes ({notes.length})</span>
        </button>
      </footer>

      {/* 4-DIGIT NUMBER LOCK MODAL */}
      {pinModalState && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0D1B38] border border-blue-100 dark:border-slate-700 rounded-2xl max-w-xs w-full p-5 space-y-3.5 shadow-xl">
            <div className="flex items-center justify-between border-b border-blue-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-[#1273FF]" />
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                  {pinModalState.mode === 'unlock' ? 'Enter 4-Digit PIN' : 'Set 4-Digit Lock'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPinModalState(null)}
                className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPinModal} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pinDigits}
                onChange={(e) => {
                  setPinError('');
                  setPinDigits(e.target.value.replace(/\D/g, '').slice(0, 4));
                }}
                placeholder="••••"
                autoFocus
                className="w-full text-center tracking-[0.5em] text-lg font-mono font-bold py-2 bg-blue-50/50 dark:bg-slate-900 border border-blue-200 dark:border-slate-700 rounded-xl focus:outline-none"
              />

              <div className="grid grid-cols-5 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => {
                      setPinError('');
                      setPinDigits((prev) => (prev.length < 4 ? prev + digit : prev));
                    }}
                    className="py-1.5 text-sm font-mono font-bold rounded-xl border border-blue-100 dark:border-slate-700 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 transition-colors cursor-pointer"
                  >
                    {digit}
                  </button>
                ))}
              </div>

              {pinError && (
                <p className="text-xs text-red-600 text-center font-semibold">{pinError}</p>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPinDigits('')}
                  className="px-3 py-1.5 text-xs font-semibold border border-blue-200 rounded-xl cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold bg-[#1273FF] text-white rounded-xl cursor-pointer"
                >
                  {pinModalState.mode === 'unlock' ? 'Unlock' : 'Lock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FILE PREVIEW MODAL */}
      {previewAttachment && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0D1B38] border border-blue-100 dark:border-slate-800 rounded-2xl max-w-xl w-full p-5 space-y-3.5 shadow-xl">
            <div className="flex items-center justify-between gap-4 border-b border-blue-100 dark:border-slate-800 pb-2.5">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-950 dark:text-white truncate">
                  {previewAttachment.attachment.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {formatBytes(previewAttachment.attachment.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="p-1 text-slate-500 hover:text-slate-900 dark:text-white rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-auto flex flex-col items-center justify-center bg-blue-50/40 dark:bg-slate-900 rounded-xl p-3">
              {previewAttachment.attachment.kind === 'image' && previewAttachment.fullUrl ? (
                <img
                  src={previewAttachment.fullUrl}
                  alt={previewAttachment.attachment.name}
                  referrerPolicy="no-referrer"
                  className="max-h-[48vh] object-contain rounded-lg"
                />
              ) : previewAttachment.attachment.textSnippet ? (
                <pre className="w-full text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap p-2">
                  {previewAttachment.attachment.textSnippet}
                </pre>
              ) : (
                <div className="py-6 text-center space-y-1">
                  <FileText className="w-7 h-7 text-[#1273FF] mx-auto" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Saved File
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              {previewAttachment.fullUrl && (
                <a
                  href={previewAttachment.fullUrl}
                  download={previewAttachment.attachment.name}
                  className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold bg-[#1273FF] text-white rounded-xl"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="px-3.5 py-1.5 text-xs font-semibold border border-blue-200 rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AES VAULT INSPECTOR MODAL */}
      {inspectingEncryptedNote && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0D1B38] border border-blue-100 dark:border-slate-800 rounded-2xl max-w-lg w-full p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between gap-4 border-b border-blue-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-[#1273FF]" />
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">
                  AES-256 Data
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingEncryptedNote(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-blue-50/40 dark:bg-slate-900 border border-blue-100 font-mono text-xs break-all max-h-40 overflow-y-auto text-slate-700 dark:text-slate-300">
              {inspectingEncryptedNote.encryptedPayload || '{"alg":"AES-256-GCM"}'}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectingEncryptedNote(null)}
                className="px-3.5 py-1.5 text-xs font-bold bg-[#1273FF] text-white rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
