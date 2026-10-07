// Core domain types for the DevWorkspace subsystem.
//
// Performance-critical design: file metadata and file content are stored
// separately in IndexedDB so we can list tens of thousands of files in the
// explorer without loading every file's content into memory.
//
// NOTE: the original DevWorkspace had its own AppTheme/AppAccent types.
// LUCIAN already has a global theme + accent system (via ThemeProvider),
// so DevWorkspace reuses that and does NOT define its own theme types.

/** Lightweight metadata for a file in a project. Always loaded. */
export interface FileEntry {
  /** Full path relative to project root, e.g. "src/App.tsx" */
  path: string;
  /** Whether the file is binary (image, font, etc.) vs. text. */
  binary: boolean;
  /** MIME type when known. */
  mime?: string;
  /** Byte length of decoded content (approximate for text). */
  size: number;
  /** Last-modified epoch milliseconds. */
  updatedAt: number;
  /** True if the content has been loaded from IndexedDB at least once. */
  loaded?: boolean;
}

/** A file entry plus its full content. Used when the file is actually opened. */
export interface ProjectFile extends FileEntry {
  content: string;
}

/** A saved historical snapshot of an entire project. */
export interface ProjectVersion {
  id: string;
  projectId: string;
  label: string;
  createdAt: number;
  /** Full deep copy of files at the moment of save. */
  files: ProjectFile[];
  /** Explicit empty folders captured with the files. */
  directories?: string[];
  /** Preview mode that was active when the snapshot was taken. */
  previewMode: PreviewMode;
}

export type PreviewMode = "real" | "demo" | "fake";

export type ResponsiveDevice = "desktop" | "tablet" | "mobile";

export interface EnvVar {
  key: string;
  value: string;
}

/** A project in the library. */
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  /** Lightweight file index — always loaded for the explorer. */
  files: FileEntry[];
  /**
   * Explicit folders, including empty folders. Folders implied by file paths
   * do not have to be listed here. Optional for projects created before the
   * Phase 5 schema extension.
   */
  directories?: string[];
  /** Detected framework, refreshed whenever files change. */
  framework: DetectedFramework;
  /** Environment variables the user has supplied for Real mode. */
  envVars: EnvVar[];
  /** Tags for quick visual identification. */
  tags: string[];
  /** Total file count (sanity check vs. files.length). */
  fileCount: number;
  /** Total byte size of all files (approximate). */
  totalSize: number;
  /** Folders that were skipped during import (node_modules, .next, etc.). */
  skippedDirs: string[];
  /** Result of scanning the project for required services / env vars. */
  scanResult?: ScanResult;
  /**
   * Soft-delete timestamp. When set, the project is in the Recycle Bin
   * and excluded from the active library list. `null` means the project
   * is live.
   */
  trashedAt: number | null;
}

export type DetectedFramework =
  | "html"
  | "react-jsx"
  | "react-tsx"
  | "react-vite"
  | "nextjs"
  | "vue"
  | "static"
  | "unknown";

/** View routes — client-side navigation inside DevWorkspace. */
export type AppView =
  | "library"
  | "workspace"
  | "visual-editor"
  | "vector-studio"
  | "converter";

export interface OpenTab {
  path: string;
  dirty: boolean;
  /** Whether the user has entered Edit mode for this tab. */
  editing: boolean;
}

// ---------------------------------------------------------------------------
// API Mocking layer types
// ---------------------------------------------------------------------------

/** A single network call intercepted by the mock layer. */
export interface MockLogEntry {
  id: string;
  url: string;
  method: string;
  /** 'live' = real call succeeded; 'mocked' = faked because real failed/missing. */
  status: "live" | "mocked";
  /** HTTP status code returned (real or fake). */
  statusCode: number;
  /** Timestamp of the call. */
  timestamp: number;
  /** Why it was mocked (only set when status === 'mocked'). */
  fakeReason?: string;
  /** Response time in ms (for real calls). */
  duration?: number;
}

/** Result of scanning a project for services / env vars it needs. */
export interface ScanResult {
  /** Environment variables referenced in .env files or code. */
  envVars: ScanEnvVar[];
  /** External services detected (databases, auth, payment, etc.). */
  services: ScanService[];
  /** When the scan was run. */
  scannedAt: number;
}

export interface ScanEnvVar {
  key: string;
  /** Where we found the reference. */
  source: "env-file" | "code-reference" | "both";
  /** Whether the user has provided a value in the Env Settings dialog. */
  configured: boolean;
  /** A human-readable hint about what this var is for. */
  hint?: string;
}

export interface ScanService {
  /** e.g. "Supabase", "Stripe", "PostgreSQL" */
  name: string;
  /** Category for grouping. */
  type: "database" | "auth" | "payment" | "email" | "storage" | "analytics" | "other";
  /** Whether the SDK/dependency was detected in the project. */
  detected: boolean;
  /** Whether required env vars appear to be configured. */
  configured: boolean;
  /** The env var keys this service needs. */
  requiredEnvVars: string[];
  /** Where we detected it (file path). */
  detectedIn?: string;
}
