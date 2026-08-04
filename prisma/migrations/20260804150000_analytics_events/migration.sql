-- CreateTable
CREATE TABLE IF NOT EXISTS "analytics_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "step" INTEGER,
    "toCountry" TEXT,
    "fromCity" TEXT,
    "toCity" TEXT,
    "sizeKey" TEXT,
    "pickupMode" TEXT,
    "deliveryMode" TEXT,
    "locale" TEXT,
    "page" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_events_createdAt_idx" ON "analytics_events"("createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_sessionId_idx" ON "analytics_events"("sessionId");
CREATE INDEX IF NOT EXISTS "analytics_events_event_idx" ON "analytics_events"("event");
