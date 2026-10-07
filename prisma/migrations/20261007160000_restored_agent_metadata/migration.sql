ALTER TABLE "AssistantConversation" ADD COLUMN "metadata" JSONB, ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "AssistantMessage" ADD COLUMN "metadata" JSONB;
