// src/lib/auth/normalizeEmail.ts
// #302: User.email is a plain, case-sensitive Postgres unique constraint —
// nothing forced signup, login, or password-reset lookups to agree on a
// canonical case. Signup wrote whatever casing the client sent, so
// `BOSS@Site.com` and `boss@site.com` could exist as two distinct User
// rows despite `isPlatformAdminEmail` (platformAdmin.ts) lowercasing both
// sides of its own comparison — an attacker who merely knew an allowlisted
// admin's email (no mailbox access needed) could sign up with a
// case-variant and pass the gate.
//
// The fix is normalizing at every read/write boundary, not a schema
// change: once every route agrees email is always stored and looked up in
// this canonical form, the existing unique constraint enforces
// case-insensitive uniqueness for free, because two case-variants of the
// same address now normalize to the identical string before the DB ever
// sees either one.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
