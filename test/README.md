# Tests

- `npm test` runs unit tests (crypto, SSRF guard, HTML sanitizer) and the end-to-end suite.
- The end-to-end suite needs a real IMAP server and is **skipped** when none is listening. It expects Dovecot at
  `127.0.0.1:1143` with user `tester@7mit.test` / `secret123` (plaintext), special-use folders Drafts/Sent/Trash/Junk.
  Override with `TEST_IMAP_PORT`, `TEST_IMAP_USER`, `TEST_IMAP_PASS`. A stub SMTP server is started by the test itself.
- The e2e test **deletes all mail** in that mailbox's INBOX/Sent/Drafts/Trash. Never point it at a real account.
