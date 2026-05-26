export type FilesystemSortOrder = "modifiedDesc" | "modifiedAsc" | "createdDesc" | "createdAsc" | "filenameAsc" | "filenameDesc" | "firstSeenDesc";
export type FilesystemDateStrategy = "modifiedTime" | "createdTime" | "firstSeen" | "currentRun";
export type FilesystemGuidStrategy = "path" | "pathAndModifiedTime" | "contentHash" | "firstSeenId";
export type FilesystemTitleStrategy = "filename" | "filenameWithoutExtension" | "relativePath" | "sidecarTitle";
export type FilesystemDescriptionStrategy = "fileMetadata" | "sidecarDescription" | "textPreview" | "none";

export type FilesystemFeedConfig = {
  rootPath: string;
  publicBaseUrl?: string;
  recursive: boolean;
  include: string[];
  exclude: string[];
  maxItems: number;
  sortOrder: FilesystemSortOrder;
  dateStrategy: FilesystemDateStrategy;
  guidStrategy: FilesystemGuidStrategy;
  titleStrategy: FilesystemTitleStrategy;
  descriptionStrategy: FilesystemDescriptionStrategy;
  sidecar?: { enabled: boolean; extension: string };
  extraction?: { enabled: boolean; maxCharacters: number; maxFileSizeBytes: number; supportedExtensions: string[] };
};

export type FilesystemSidecarMetadata = {
  title?: string;
  description?: string;
  date?: string;
  link?: string;
  categories?: string[];
  author?: string;
  guid?: string;
};

export type FilesystemFeedItem = {
  id: string;
  absolutePath: string;
  relativePath: string;
  publicUrl?: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  createdAt?: Date;
  modifiedAt?: Date;
  firstSeenAt?: Date;
  contentHash?: string;
  title: string;
  description?: string;
  link?: string;
  author?: string;
  categories?: string[];
  guid: string;
  pubDate: Date;
};

export type FilesystemFeedState = {
  files: Record<string, { firstSeenAt: string; lastSeenAt: string; lastModifiedAt?: string; lastSizeBytes?: number; stableId: string }>;
};

export type FilesystemScanResult = {
  items: FilesystemFeedItem[];
  warnings: string[];
  stats: {
    scannedFiles: number;
    matchedFiles: number;
    excludedFiles: number;
    skippedDirectories: number;
    skippedSymlinks: number;
    sidecarFilesRead: number;
    sidecarFilesFailed: number;
  };
};
