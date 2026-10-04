# Ledgerly Security Model

Ledgerly is designed to protect private debt data on a normal personal device and in exported encrypted backups. It is not designed to defend a device that is already fully compromised by malware or an attacker with arbitrary code execution.

## Protected against
- Casual access after Ledgerly locks.
- Readable local ledger data when master-password protection is enabled.
- Readable attachments after protection is enabled.
- Readable encrypted backup content without the password/recovery key.
- Stale-tab overwrites and common accidental data replacement.
- Remote third-party tracking: Ledgerly uses no analytics/CDNs/remote fonts.

## Cryptography
- AES-GCM 256-bit data encryption.
- Random 256-bit data-encryption key.
- PBKDF2-SHA256 password key derivation (420,000 iterations in this build).
- Optional recovery-key wrapper uses PBKDF2-SHA256 (260,000 iterations).
- SHA-256 backup checksum and audit hash links.

## Password loss
If protection is enabled and both the master password and recovery key are lost, the encrypted ledger is intentionally unrecoverable.

## Privacy mode
Privacy mode is a screen-display control, not encryption. Use master-password protection for data-at-rest security.

## Attachments
Images are re-encoded before storage to remove common EXIF/GPS metadata. PDFs are stored as supplied. Encrypted ledgers encrypt attachment bytes in IndexedDB.
