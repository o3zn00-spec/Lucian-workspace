-- Historical migration tombstone.
--
-- The Coinbase-specific tables that once belonged to this migration were
-- superseded and are removed defensively by 20260902020000_bybit_replacement.
-- Keeping a valid no-op migration file makes fresh `prisma migrate deploy`
-- runs deterministic while preserving the historical migration identifier.
SELECT 1;
