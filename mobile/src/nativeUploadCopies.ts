import { createUploadCopies, type UploadFileSystem } from './uploadCopies';

// SDK 54 legacy source types conflict with exactOptionalPropertyTypes; contain the native adapter.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const files = require('expo-file-system/legacy') as UploadFileSystem;
export const uploadCopies = createUploadCopies(files);
