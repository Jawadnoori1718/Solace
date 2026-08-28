-- CreateTable
CREATE TABLE "Pot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "councilName" TEXT NOT NULL,
    "fundingSource" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "potId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "depositedAt" DATETIME NOT NULL,
    "chain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "explorerUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deposit_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "solarCapacityKw" REAL,
    "onMeansTestedBenefit" BOOLEAN,
    "epcBand" TEXT,
    "occupants" INTEGER,
    "hasChildUnderFive" BOOLEAN,
    "hasResidentOverSixtyFive" BOOLEAN,
    "hasHealthCondition" BOOLEAN,
    "onPrepaymentMeter" BOOLEAN,
    "coldWeatherBaselineKwh" REAL,
    "recipientHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "intervalStart" DATETIME NOT NULL,
    "channel" TEXT NOT NULL,
    "kwh" REAL NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "MeterReading_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NeedSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL,
    "caseNote" TEXT NOT NULL,
    "parsedJson" TEXT,
    "vulnerabilityScore" REAL,
    "parserModel" TEXT,
    "parserVersion" TEXT,
    "parsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NeedSignal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AllocationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "potId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "outputDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllocationRun_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "exporterId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kwh" REAL NOT NULL,
    "milliKwh" INTEGER NOT NULL,
    "pencePerKwh" INTEGER NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "reasoningJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Allocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AllocationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Allocation_exporterId_fkey" FOREIGN KEY ("exporterId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Allocation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Household" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "allocationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "potReference" TEXT NOT NULL,
    "milliKwh" INTEGER NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "tokenAmountRaw" TEXT NOT NULL,
    "txHash" TEXT,
    "blockNumber" INTEGER,
    "explorerUrl" TEXT,
    "failureReason" TEXT,
    "submittedAt" DATETIME,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Settlement_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "deployTxHash" TEXT NOT NULL,
    "blockNumber" INTEGER,
    "explorerUrl" TEXT,
    "deployedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "potId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "narrative" TEXT NOT NULL,
    "factsJson" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Pot_reference_key" ON "Pot"("reference");

-- CreateIndex
CREATE INDEX "Deposit_potId_depositedAt_idx" ON "Deposit"("potId", "depositedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Household_reference_key" ON "Household"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Household_recipientHash_key" ON "Household"("recipientHash");

-- CreateIndex
CREATE INDEX "Household_role_idx" ON "Household"("role");

-- CreateIndex
CREATE INDEX "MeterReading_intervalStart_idx" ON "MeterReading"("intervalStart");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_householdId_intervalStart_channel_key" ON "MeterReading"("householdId", "intervalStart", "channel");

-- CreateIndex
CREATE INDEX "NeedSignal_householdId_recordedAt_idx" ON "NeedSignal"("householdId", "recordedAt");

-- CreateIndex
CREATE INDEX "AllocationRun_potId_createdAt_idx" ON "AllocationRun"("potId", "createdAt");

-- CreateIndex
CREATE INDEX "Allocation_runId_rank_idx" ON "Allocation"("runId", "rank");

-- CreateIndex
CREATE INDEX "Allocation_recipientId_idx" ON "Allocation"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_allocationId_key" ON "Settlement"("allocationId");

-- CreateIndex
CREATE INDEX "Settlement_status_idx" ON "Settlement"("status");

-- CreateIndex
CREATE INDEX "Settlement_createdAt_idx" ON "Settlement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDeployment_chain_name_key" ON "ContractDeployment"("chain", "name");

-- CreateIndex
CREATE INDEX "Report_potId_generatedAt_idx" ON "Report"("potId", "generatedAt");
