# Security Specification — DayNote (Notes, Tasks & Reminders)

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document in `/notes/{noteId}` belongs exclusively to a single authenticated user (`ownerId == request.auth.uid`). No user may read, list, create, update, or delete another user's notes.
2. **Verified Identity**: All write mutations (`create`, `update`, `delete`) require a verified email token (`request.auth.token.email_verified == true`).
3. **Immutable Provenance**: Once a note is created, `ownerId` and `createdAt` can never be mutated during any `update` operation.
4. **Temporal Integrity**: `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on both creation and update.
5. **Volumetric & Schema Guardrails**: All string fields enforce strict `.size()` upper bounds matching `firebase-blueprint.json` (`title <= 500`, `content <= 20000`, `encryptedPayload <= 60000`, `attachmentsSummary <= 250000`, `language in ['en-IN', 'te-IN', 'hi-IN']`), and `attachmentCount` is bounded between `0` and `20`.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing on Create**:
   `{ "ownerId": "victim_uid_999", "title": "Spoofed", "content": "...", ... }` -> Rejected (`data.ownerId == request.auth.uid` fails).
2. **Unverified Email Write**:
   Auth context `{ uid: "user_1", token: { email_verified: false } }` attempting `create` -> Rejected (`isVerifiedUser()` fails).
3. **Shadow Field Injection on Create**:
   Adding `"isAdmin": true` or `"ghostField": "pwn"` -> Rejected (`data.keys().hasOnly(...)` fails).
4. **Shadow Field Injection on Update**:
   Updating note with `{ "title": "Updated", "extra": 123 }` -> Rejected (`affectedKeys().hasOnly(...)` fails).
5. **Immutable Field Mutation (`ownerId` Transfer)**:
   Updating `ownerId` from `"user_1"` to `"user_2"` -> Rejected (`incoming().ownerId == existing().ownerId` fails).
6. **Immutable Timestamp Backdating (`createdAt` Tampering)**:
   Updating `createdAt` to a past timestamp -> Rejected (`incoming().createdAt == existing().createdAt` fails).
7. **Forged Client `updatedAt` Timestamp**:
   Sending a future or past `updatedAt` timestamp instead of `serverTimestamp()` (`request.time`) -> Rejected (`incoming().updatedAt == request.time` fails).
8. **Resource Exhaustion / Denial of Wallet (`title` > 500 chars)**:
   Sending a 10,000-character string in `title` -> Rejected (`data.title.size() <= 500` fails).
9. **Path ID Poisoning**:
   Creating a document with a 500-character or special-character `noteId` -> Rejected (`isValidId(noteId)` fails).
10. **Invalid Language Enum Injection**:
    Setting `language: "xx-HACK"` -> Rejected (`data.language in ['en-IN', 'te-IN', 'hi-IN']` fails).
11. **Cross-Tenant List Scraping**:
    Authenticated user executing an unfiltered `getDocs(collection(db, 'notes'))` -> Rejected (`allow list` requires `resource.data.ownerId == request.auth.uid`).
12. **Value Poisoning on Whitelisted Update Key**:
    Updating `attachmentCount` to `-5` or `"not-a-number"` -> Rejected (`isValidNote(incoming())` wraps the entire `allow update` rule).
