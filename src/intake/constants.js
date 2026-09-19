export const SOURCE_SCHEMA_VERSION = 1;

export const SOURCE_TYPES = Object.freeze(['text', 'file']);

export const SUPPORTED_FILE_EXTENSIONS = Object.freeze(['.md', '.txt', '.json', '.yaml', '.yml', '.csv']);

export const CONTENT_TYPES_BY_EXTENSION = Object.freeze({
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.csv': 'text/csv'
});
