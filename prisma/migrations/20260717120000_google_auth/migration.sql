-- AlterTable
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'local';

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
