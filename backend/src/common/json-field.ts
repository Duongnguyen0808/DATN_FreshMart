/** Serializes objects/arrays for SQL Server NVARCHAR(MAX) storage while allowing null/string passthrough. */
export function toJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {});
}

/** Nullable JSON string serializer for optional fields. */
export function toJsonNullable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Safely parses JSON strings from SQL Server back into JS objects/arrays. */
export function parseJson<T = Record<string, unknown>>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value as T;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

