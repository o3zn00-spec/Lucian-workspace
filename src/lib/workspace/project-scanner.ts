// Project scanner — inspects a project's files on import to detect what
// external services and environment variables it needs. Produces a
// "what's needed to go live" checklist that works for any project structure.

import type {
  EnvVar,
  ProjectFile,
  ScanEnvVar,
  ScanResult,
  ScanService,
} from "@/types/workspace";

// ---------------------------------------------------------------------------
// Service definitions — maps dependency names / code patterns to a service
// with its required env vars. This is framework-agnostic.
// ---------------------------------------------------------------------------

interface ServiceDef {
  name: string;
  type: ScanService["type"];
  /** Package names to look for in package.json deps. */
  packages?: string[];
  /** Code patterns to search for (case-insensitive). */
  codePatterns?: RegExp[];
  /** Env var keys this service typically needs. */
  envVars: string[];
  hint?: string;
}

const SERVICE_DEFS: ServiceDef[] = [
  // ---- Databases ----
  {
    name: "Supabase",
    type: "database",
    packages: ["@supabase/supabase-js"],
    codePatterns: [/supabase\.co/i, /createClient\s*\(/i],
    envVars: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    hint: "Postgres + Auth + Storage backend",
  },
  {
    name: "Firebase",
    type: "database",
    packages: ["firebase", "@firebase/app"],
    codePatterns: [/firebase\.googleapis\.com/i, /initializeApp\s*\(/i],
    envVars: ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_STORAGE_BUCKET", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "NEXT_PUBLIC_FIREBASE_API_KEY"],
    hint: "Google Firebase (Firestore, Auth, Storage)",
  },
  {
    name: "PostgreSQL (direct)",
    type: "database",
    codePatterns: [/postgresql?:\/\//i, /pg\.Pool/i, /pg\.Client/i, /neondatabase/i, /@neondatabase\/serverless/i],
    envVars: ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"],
    hint: "Direct Postgres connection",
  },
  {
    name: "MySQL",
    type: "database",
    codePatterns: [/mysql:\/\//i, /mysql2/i, /createConnection\s*\(/i],
    envVars: ["MYSQL_URL", "MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"],
    hint: "MySQL database",
  },
  {
    name: "MongoDB",
    type: "database",
    codePatterns: [/mongodb(\+srv)?:\/\//i, /mongoose/i, /MongoClient/i],
    envVars: ["MONGODB_URI", "MONGO_URL", "MONGODB_URL"],
    hint: "MongoDB database",
  },
  {
    name: "Redis",
    type: "database",
    codePatterns: [/redis:\/\//i, /ioredis/i, /createClient\s*\(/i],
    envVars: ["REDIS_URL", "REDIS_HOST", "REDIS_PASSWORD"],
    hint: "Redis cache/session store",
  },
  {
    name: "Prisma",
    type: "database",
    packages: ["@prisma/client", "prisma"],
    codePatterns: [/prisma\.client/i, /PrismaClient/i, /schema\.prisma/i],
    envVars: ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL"],
    hint: "Prisma ORM — needs a DATABASE_URL",
  },

  // ---- Auth providers ----
  {
    name: "Auth0",
    type: "auth",
    packages: ["@auth0/nextjs-auth0", "auth0-js"],
    codePatterns: [/auth0\.com/i],
    envVars: ["AUTH0_SECRET", "AUTH0_BASE_URL", "AUTH0_ISSUER_BASE_URL", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET"],
    hint: "Auth0 authentication",
  },
  {
    name: "NextAuth.js",
    type: "auth",
    packages: ["next-auth"],
    codePatterns: [/NextAuth/i, /next-auth\/api/i],
    envVars: ["NEXTAUTH_SECRET", "NEXTAUTH_URL", "AUTH_SECRET", "AUTH_URL"],
    hint: "NextAuth.js authentication",
  },
  {
    name: "Clerk",
    type: "auth",
    packages: ["@clerk/nextjs", "@clerk/clerk-js"],
    codePatterns: [/clerk\.com/i],
    envVars: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_SIGN_IN_URL", "CLERK_SIGN_UP_URL"],
    hint: "Clerk authentication",
  },

  // ---- Payment providers ----
  {
    name: "Stripe",
    type: "payment",
    packages: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"],
    codePatterns: [/api\.stripe\.com/i, /stripe\.com\/v1/i],
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"],
    hint: "Stripe payments",
  },
  {
    name: "PayPal",
    type: "payment",
    packages: ["@paypal/react-paypal-js", "paypal-rest-sdk"],
    codePatterns: [/paypal\.com/i],
    envVars: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "NEXT_PUBLIC_PAYPAL_CLIENT_ID"],
    hint: "PayPal payments",
  },

  // ---- Email providers ----
  {
    name: "Resend",
    type: "email",
    packages: ["resend"],
    codePatterns: [/resend\.com/i, /Resend\s*\(/i],
    envVars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    hint: "Resend email service",
  },
  {
    name: "SendGrid",
    type: "email",
    packages: ["@sendgrid/mail"],
    codePatterns: [/sendgrid/i],
    envVars: ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
    hint: "SendGrid email service",
  },
  {
    name: "Postmark",
    type: "email",
    packages: ["postmark"],
    codePatterns: [/postmarkapp\.com/i],
    envVars: ["POSTMARK_API_TOKEN", "POSTMARK_FROM_EMAIL"],
    hint: "Postmark email service",
  },
  {
    name: "AWS SES",
    type: "email",
    packages: ["@aws-sdk/client-ses"],
    codePatterns: [/ses\.(amazonaws|aws)/i],
    envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "SES_FROM_EMAIL"],
    hint: "AWS Simple Email Service",
  },

  // ---- Storage providers ----
  {
    name: "Vercel Blob",
    type: "storage",
    packages: ["@vercel/blob"],
    codePatterns: [/blob\.vercel\.app/i, /put\s*\(/i],
    envVars: ["BLOB_READ_WRITE_TOKEN"],
    hint: "Vercel Blob file storage",
  },
  {
    name: "AWS S3",
    type: "storage",
    packages: ["@aws-sdk/client-s3", "aws-sdk"],
    codePatterns: [/s3\.(amazonaws|aws)/i, /S3Client/i],
    envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "S3_BUCKET", "S3_ENDPOINT"],
    hint: "AWS S3 file storage",
  },
  {
    name: "Cloudinary",
    type: "storage",
    packages: ["cloudinary", "next-cloudinary"],
    codePatterns: [/cloudinary\.com/i, /cloudinary\.config/i],
    envVars: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"],
    hint: "Cloudinary image/video management",
  },

  // ---- Analytics ----
  {
    name: "Google Analytics",
    type: "analytics",
    codePatterns: [/googletagmanager\.com\/gtag\/js/i, /gtag\s*\(/i, /GA_TRACKING_ID/i],
    envVars: ["NEXT_PUBLIC_GA_TRACKING_ID", "GA_TRACKING_ID", "GA_MEASUREMENT_ID"],
    hint: "Google Analytics tracking",
  },
  {
    name: "PostHog",
    type: "analytics",
    packages: ["posthog-js", "posthog-node"],
    codePatterns: [/posthog\.com/i, /posthog\.init/i],
    envVars: ["NEXT_PUBLIC_POSTHOG_KEY", "POSTHOG_KEY", "POSTHOG_HOST"],
    hint: "PostHog product analytics",
  },
  {
    name: "Mixpanel",
    type: "analytics",
    packages: ["mixpanel-browser"],
    codePatterns: [/mixpanel\.com/i, /mixpanel\.init/i],
    envVars: ["NEXT_PUBLIC_MIXPANEL_TOKEN", "MIXPANEL_TOKEN"],
    hint: "Mixpanel analytics",
  },
];

// ---------------------------------------------------------------------------
// Env var hints — maps common env var names to human-readable descriptions.
// ---------------------------------------------------------------------------

const ENV_VAR_HINTS: Record<string, string> = {
  DATABASE_URL: "PostgreSQL/MySQL connection string",
  DIRECT_URL: "Direct database URL (for migrations)",
  JWT_SECRET: "Secret for signing JWT tokens",
  NEXTAUTH_SECRET: "NextAuth.js encryption secret",
  NEXTAUTH_URL: "NextAuth.js app URL",
  AUTH_SECRET: "Auth.js encryption secret",
  STRIPE_SECRET_KEY: "Stripe API secret key (sk_...)",
  STRIPE_PUBLISHABLE_KEY: "Stripe publishable key (pk_...)",
  STRIPE_WEBHOOK_SECRET: "Stripe webhook signing secret (whsec_...)",
  SUPABASE_URL: "Supabase project URL (https://xxx.supabase.co)",
  SUPABASE_ANON_KEY: "Supabase anonymous public key",
  SUPABASE_SERVICE_ROLE_KEY: "Supabase service role key (server-side only)",
  RESEND_API_KEY: "Resend email API key (re_...)",
  SENDGRID_API_KEY: "SendGrid API key (SG....)",
  BLOB_READ_WRITE_TOKEN: "Vercel Blob read/write token",
  AWS_ACCESS_KEY_ID: "AWS access key ID",
  AWS_SECRET_ACCESS_KEY: "AWS secret access key",
  AWS_REGION: "AWS region (e.g. us-east-1)",
  FIREBASE_API_KEY: "Firebase web API key",
  OPENAI_API_KEY: "OpenAI API key (sk-...)",
  ANTHROPIC_API_KEY: "Anthropic API key (sk-ant-...)",
  GOOGLE_MAPS_API_KEY: "Google Maps JavaScript API key",
  MAILGUN_API_KEY: "Mailgun API key",
  TWILIO_ACCOUNT_SID: "Twilio account SID",
  TWILIO_AUTH_TOKEN: "Twilio auth token",
};

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/** Scan a project's files and produce a "what's needed to go live" checklist. */
export function scanProject(
  files: ProjectFile[],
  configuredEnvVars: EnvVar[],
): ScanResult {
  const configuredKeys = new Set(configuredEnvVars.map((e) => e.key));

  // ---- Collect env var references ----
  const envVarRefs = new Map<string, Set<"env-file" | "code-reference">>();

  // Parse .env files.
  for (const f of files) {
    if (f.binary) continue;
    const basename = f.path.split("/").pop() ?? "";
    if (
      basename === ".env" ||
      basename === ".env.example" ||
      basename === ".env.local" ||
      basename === ".env.development" ||
      basename === ".env.production" ||
      basename === ".env.staging" ||
      /^\.env\./.test(basename)
    ) {
      const lines = f.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/i);
        if (match) {
          const key = match[1];
          if (!envVarRefs.has(key)) envVarRefs.set(key, new Set());
          envVarRefs.get(key)!.add("env-file");
        }
      }
    }
  }

  // Search code for process.env.X and import.meta.env.VITE_X references.
  // We only search text files and cap the search at the first 50KB per file
  // for performance.
  for (const f of files) {
    if (f.binary) continue;
    const content = f.content.length > 50000 ? f.content.slice(0, 50000) : f.content;

    // process.env.X
    const processEnvMatches = content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/gi);
    for (const m of processEnvMatches) {
      const key = m[1];
      if (!envVarRefs.has(key)) envVarRefs.set(key, new Set());
      envVarRefs.get(key)!.add("code-reference");
    }

    // import.meta.env.VITE_X
    const viteEnvMatches = content.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/gi);
    for (const m of viteEnvMatches) {
      const key = m[1];
      if (!envVarRefs.has(key)) envVarRefs.set(key, new Set());
      envVarRefs.get(key)!.add("code-reference");
    }

    // Also catch NEXT_PUBLIC_X and VITE_X patterns in string literals.
    const publicEnvMatches = content.matchAll(/["'](NEXT_PUBLIC_[A-Z0-9_]+|VITE_[A-Z0-9_]+)["']/g);
    for (const m of publicEnvMatches) {
      const key = m[1];
      if (!envVarRefs.has(key)) envVarRefs.set(key, new Set());
      envVarRefs.get(key)!.add("code-reference");
    }
  }

  // Build env var list.
  const envVars: ScanEnvVar[] = Array.from(envVarRefs.entries())
    .map(([key, sources]) => {
      const sourceSet = sources;
      const source: ScanEnvVar["source"] =
        sourceSet.has("env-file") && sourceSet.has("code-reference")
          ? "both"
          : sourceSet.has("env-file")
            ? "env-file"
            : "code-reference";
      return {
        key,
        source,
        configured: configuredKeys.has(key),
        hint: ENV_VAR_HINTS[key],
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  // ---- Detect services ----
  const services: ScanService[] = [];
  const pkgFile = files.find((f) => f.path === "package.json");
  let pkgDeps: Record<string, string> = {};
  if (pkgFile && !pkgFile.binary) {
    try {
      const json = JSON.parse(pkgFile.content);
      pkgDeps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
    } catch {
      // ignore parse errors
    }
  }

  for (const def of SERVICE_DEFS) {
    let detected = false;
    let detectedIn: string | undefined;

    // Check package.json deps.
    if (def.packages) {
      for (const pkg of def.packages) {
        if (pkgDeps[pkg]) {
          detected = true;
          detectedIn = "package.json";
          break;
        }
      }
    }

    // Check code patterns (search up to 100KB per file, cap at 30 files).
    if (!detected && def.codePatterns) {
      const filesToSearch = files.filter((f) => !f.binary).slice(0, 30);
      for (const f of filesToSearch) {
        const content = f.content.length > 100000 ? f.content.slice(0, 100000) : f.content;
        for (const pattern of def.codePatterns) {
          if (pattern.test(content)) {
            detected = true;
            detectedIn = f.path;
            break;
          }
        }
        if (detected) break;
      }
    }

    if (!detected) continue;

    // Check if required env vars are configured.
    const configured = def.envVars.some((key) => configuredKeys.has(key));

    services.push({
      name: def.name,
      type: def.type,
      detected: true,
      configured,
      requiredEnvVars: def.envVars,
      detectedIn,
    });
  }

  return {
    envVars,
    services,
    scannedAt: Date.now(),
  };
}

/** Count how many items in a scan result are "missing" (not configured). */
export function countMissing(scan: ScanResult | undefined): {
  missingEnvVars: number;
  unconfiguredServices: number;
  total: number;
} {
  if (!scan) return { missingEnvVars: 0, unconfiguredServices: 0, total: 0 };
  const missingEnvVars = scan.envVars.filter((e) => !e.configured).length;
  const unconfiguredServices = scan.services.filter((s) => !s.configured).length;
  return {
    missingEnvVars,
    unconfiguredServices,
    total: missingEnvVars + unconfiguredServices,
  };
}
