/**
 * Security Rules Specification Test Suite for DayNote (/notes/{noteId})
 * Validates that all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Create (ownerId mismatch)',
    operation: 'create',
    path: '/notes/note_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_b', title: 'Spoofed' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write Attempt',
    operation: 'create',
    path: '/notes/note_2',
    auth: { uid: 'user_a', email_verified: false },
    payload: { ownerId: 'user_a', title: 'Unverified' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Create',
    operation: 'create',
    path: '/notes/note_3',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_a', title: 'Valid', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Update',
    operation: 'update',
    path: '/notes/note_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { title: 'Updated', ghostField: 'injected' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Immutable ownerId Transfer on Update',
    operation: 'update',
    path: '/notes/note_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_b' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Immutable createdAt Backdating on Update',
    operation: 'update',
    path: '/notes/note_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Forged Client updatedAt Timestamp',
    operation: 'update',
    path: '/notes/note_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { updatedAt: '2099-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Denial of Wallet Oversized Title (> 500 chars)',
    operation: 'create',
    path: '/notes/note_8',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_a', title: 'A'.repeat(501) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Path ID Poisoning (Invalid Characters in noteId)',
    operation: 'create',
    path: '/notes/invalid$id!@#',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_a', title: 'Test' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Invalid Language Enum Injection',
    operation: 'create',
    path: '/notes/note_10',
    auth: { uid: 'user_a', email_verified: true },
    payload: { ownerId: 'user_a', language: 'fr-FR' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Cross-Tenant Document Read Attempt',
    operation: 'get',
    path: '/notes/user_b_note',
    auth: { uid: 'user_a', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning on Whitelisted Update Key (attachmentCount > 20)',
    operation: 'update',
    path: '/notes/note_1',
    auth: { uid: 'user_a', email_verified: true },
    payload: { attachmentCount: 999 },
    expectedResult: 'PERMISSION_DENIED',
  },
];
