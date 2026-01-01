-- Supabase Storage Bucket Setup for Card Attachments
-- Run this in your Supabase SQL Editor to enable file attachments
--
-- Security: Each user can only access files in their own folder.
-- Path structure: {userId}/{cardId}/{attachmentId}_{filename}
-- The RLS policies ensure complete user isolation.

-- Create the storage bucket (private, requires signed URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'card-attachments',
  'card-attachments',
  false,  -- Private bucket (requires signed URLs to access)
  10485760,  -- 10MB file size limit
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'text/markdown',
    'application/json',
    'application/zip', 'application/x-zip-compressed'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policy: Users can only UPLOAD to their own folder
-- The first folder segment must match their user ID
CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'card-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS Policy: Users can only READ their own files
CREATE POLICY "Users can read own files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'card-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS Policy: Users can only DELETE their own files
CREATE POLICY "Users can delete own files"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'card-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS Policy: Users can only UPDATE their own files (rarely needed, but complete)
CREATE POLICY "Users can update own files"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'card-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Note: These policies ensure complete user isolation:
-- - User A cannot see, download, or delete User B's files
-- - Even if someone guesses a file path, they cannot access it without auth
-- - Signed URLs are scoped to the authenticated user's session
