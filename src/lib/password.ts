// src/lib/password.ts
// Password hashing utilities using bcrypt
// NEVER store plain text passwords!

import bcrypt from 'bcryptjs'

/**
 * Hash a plain text password
 * @param password - The plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10 // Higher = more secure but slower
  return bcrypt.hash(password, saltRounds)
}

/**
 * Compare a plain text password with a hashed password
 * @param password - Plain text password to check
 * @param hashedPassword - The hashed password from database
 * @returns true if passwords match
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}
