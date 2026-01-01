import React from "react";
import { nanoid } from "nanoid";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Attachment } from "./types";

const BUCKET_NAME = "card-attachments";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type UploadProgress = {
  attachmentId: string;
  progress: number; // 0-100
  status: "uploading" | "complete" | "error";
  error?: string;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
}

export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useAttachments(userId: string | null, cardId: string) {
  const [uploads, setUploads] = React.useState<UploadProgress[]>([]);

  const uploadFile = React.useCallback(
    async (file: File): Promise<Attachment | null> => {
      if (!supabase || !userId) {
        console.error("Supabase not configured or user not authenticated");
        return null;
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is 10MB.`);
      }

      const attachmentId = nanoid();
      const sanitizedName = sanitizeFilename(file.name);
      const storagePath = `${userId}/${cardId}/${attachmentId}_${sanitizedName}`;

      // Add to upload tracking
      setUploads((prev) => [
        ...prev,
        {
          attachmentId,
          progress: 0,
          status: "uploading"
        }
      ]);

      try {
        const { error } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false
          });

        if (error) throw error;

        // Update progress to complete
        setUploads((prev) =>
          prev.map((u) =>
            u.attachmentId === attachmentId
              ? { ...u, progress: 100, status: "complete" as const }
              : u
          )
        );

        const attachment: Attachment = {
          id: attachmentId,
          name: file.name,
          size: file.size,
          type: file.type,
          storagePath,
          createdAt: new Date().toISOString()
        };

        return attachment;
      } catch (error) {
        setUploads((prev) =>
          prev.map((u) =>
            u.attachmentId === attachmentId
              ? { ...u, status: "error" as const, error: (error as Error).message }
              : u
          )
        );
        throw error;
      }
    },
    [userId, cardId]
  );

  const deleteFile = React.useCallback(async (storagePath: string): Promise<boolean> => {
    if (!supabase) return false;

    const { error } = await supabase.storage.from(BUCKET_NAME).remove([storagePath]);

    if (error) {
      console.error("Failed to delete file:", error);
      return false;
    }
    return true;
  }, []);

  const getSignedUrl = React.useCallback(async (storagePath: string): Promise<string | null> => {
    if (!supabase) return null;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, 3600); // 1 hour expiry

    if (error) {
      console.error("Failed to get signed URL:", error);
      return null;
    }
    return data.signedUrl;
  }, []);

  const clearUploadStatus = React.useCallback((attachmentId: string) => {
    setUploads((prev) => prev.filter((u) => u.attachmentId !== attachmentId));
  }, []);

  return {
    uploadFile,
    deleteFile,
    getSignedUrl,
    uploads,
    clearUploadStatus,
    isConfigured: isSupabaseConfigured()
  };
}
