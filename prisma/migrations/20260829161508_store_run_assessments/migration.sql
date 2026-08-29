-- AlterTable
ALTER TABLE "AllocationRun" ADD COLUMN "assessmentsJson" TEXT;
ALTER TABLE "AllocationRun" ADD COLUMN "unallocatedKwh" REAL;
ALTER TABLE "AllocationRun" ADD COLUMN "unservedJson" TEXT;
