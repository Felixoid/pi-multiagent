export const PACKAGE_SURFACE_BUDGET = {
	maxUnpackedSizeBytes: 750_000,
	maxPackedFiles: 119,
} as const;

export const SOURCE_FILE_BUDGET = {
	maxLines: 500,
	maxBytes: 18 * 1024,
	rootDirectories: ["extensions"],
} as const;

export const RELEASE_PACKAGE_MANAGER = "pnpm@11.1.2";
