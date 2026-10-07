import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { isValidEmail, normalizeEmail, validatePasswordDetailed } from "../src/lib/auth/validation";

const db = new PrismaClient();

async function main() {
  if (!process.argv.includes("--confirm-owner-reset")) throw new Error("Recovery refused. Re-run with --confirm-owner-reset after confirming the configured owner identity.");
  const email = normalizeEmail(process.env.LUCIAN_OWNER_EMAIL || "");
  const password = process.env.LUCIAN_OWNER_RECOVERY_PASSWORD || "";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!isValidEmail(email)) throw new Error("LUCIAN_OWNER_EMAIL must be a valid email address.");
  const passwordError = validatePasswordDetailed(password);
  if (passwordError) throw new Error(`LUCIAN_OWNER_RECOVERY_PASSWORD: ${passwordError.message}`);

  const owner = await db.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (!owner) throw new Error("The configured owner account does not exist. Run npm run bootstrap:owner first.");
  const passwordHash = await bcrypt.hash(password, 12);
  await db.$transaction([
    db.user.update({ where: { id: owner.id }, data: { passwordHash, status: "active", sessionVersion: { increment: 1 } } }),
    db.passwordResetToken.deleteMany({ where: { userId: owner.id } }),
    db.user.updateMany({ where: { id: { not: owner.id }, status: { not: "disabled" } }, data: { status: "disabled", sessionVersion: { increment: 1 } } }),
  ]);
  console.log("[recover:owner] Owner access recovered. Every existing owner session was invalidated; sign in with the new password.");
}

main()
  .catch((error) => { console.error("[recover:owner] FAILED:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; })
  .finally(async () => db.$disconnect());
