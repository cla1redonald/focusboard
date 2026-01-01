import { supabase } from "./supabase";
import type { Attachment } from "./types";

const BUCKET_NAME = "card-attachments";

/**
 * Delete all attachments for a card from Supabase Storage.
 * Called when a card is deleted.
 */
export async function cleanupCardAttachments(attachments: Attachment[]): Promise<void> {
  if (!supabase || attachments.length === 0) return;

  const paths = attachments.map((a) => a.storagePath);
  const { error } = await supabase.storage.from(BUCKET_NAME).remove(paths);

  if (error) {
    console.error("Failed to cleanup attachments:", error);
  }
}
