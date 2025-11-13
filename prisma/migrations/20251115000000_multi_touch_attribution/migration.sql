-- Add new ad providers to CredentialProvider enum
DO $$
BEGIN
    ALTER TYPE "CredentialProvider" ADD VALUE 'AMAZON_ADS';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
    ALTER TYPE "CredentialProvider" ADD VALUE 'SNAPCHAT_ADS';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END$$;

-- Update unique index on attribution rules to include ruleType
DROP INDEX IF EXISTS "AttributionRule_merchantId_provider_key";
CREATE UNIQUE INDEX "AttributionRule_merchantId_provider_ruleType_key" ON "AttributionRule"("merchantId", "provider", "ruleType");
