// The ingest queue's message contract, as it travels on the queue. `POST /uploads/:id/complete`
// in the web Worker produces it (ARCHITECTURE, Ingestion pipeline, step 3); the ingest Worker
// consumes it. A producer types its queue with this.
export interface IngestMessage {
  upload_id: string;
}

// Upload ids are random text (packages/db, 0002): a uuid in practice, bounded here.
const MAX_ID = 64;

// Returns the message if its body keeps the contract, or null. A body that doesn't names no
// upload, so retrying it can never succeed.
export function parseMessage(body: unknown): IngestMessage | null {
  if (typeof body !== "object" || body === null) return null;
  // SAFETY: body is a non-null object, so reading a named property off it is safe; the value
  // is checked below.
  const { upload_id } = body as Record<string, unknown>;
  if (typeof upload_id !== "string" || upload_id.length === 0 || upload_id.length > MAX_ID) {
    return null;
  }
  return { upload_id };
}
