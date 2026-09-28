-- Add RefreshToken: opaque refresh tokens backing the httpOnly session
-- cookies (see src/lib/auth.ts and src/lib/refreshToken.ts).
--
-- The access token is a short-lived JWT the client never sees; the refresh
-- token is a 256-bit random value whose SHA-256 hash is stored here. The
-- plaintext lives only in the httpOnly cookie. Purely additive: no
-- existing table is touched, no backfill needed.
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
