# Supabase Storage Setup for Batch Video Generation

To enable batch video generation with image uploads, you need to set up a Supabase Storage bucket.

## Steps:

### 1. Create Storage Bucket

1. Go to your Supabase project dashboard
2. Navigate to **Storage** in the left sidebar
3. Click **New bucket**
4. Configure the bucket:
   - **Name:** `images`
   - **Public bucket:** ✅ Check this (required for public URLs)
   - **File size limit:** 10 MB (or adjust as needed)
   - Click **Create bucket**

### 2. Configure Bucket Policies

The bucket needs to be publicly accessible for reading (but only server can upload):

1. Go to **Storage** > **Policies** tab
2. Click **New policy** for the `images` bucket
3. Create a policy for public read access:

```sql
-- Policy name: Public read access
-- Target roles: public
-- Allowed operation: SELECT

CREATE POLICY "Public read access"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'images');
```

4. The upload policy is already handled server-side using the service role key

### 3. Verify Environment Variables

Make sure you have these environment variables set in your `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

The `SUPABASE_SERVICE_ROLE_KEY` is required for uploading files.

### 4. Test the Upload

1. Go to Video tab
2. Enable **Batch Mode: 1 Prompt + Multiple Images**
3. Click **Choose File** and select multiple images
4. You should see:
   - "Uploading images..." while uploading
   - Image previews in a 3-column grid
   - "X image(s) uploaded and ready" when complete
5. Enter a prompt and click **Generate X Videos**

## How It Works

1. User uploads images via file input
2. Images are converted to data URLs for preview display
3. Files are sent to `/api/upload` endpoint
4. Server uploads files to Supabase Storage bucket `images/batch-videos/`
5. Public URLs are returned and stored
6. When generating videos, these public URLs are sent to KIE.ai API
7. Videos are generated using the uploaded images

## File Structure in Storage

Uploaded files are stored with this naming pattern:
```
images/
  batch-videos/
    1704067200000-abc123.jpg
    1704067201000-def456.png
    ...
```

Each file is named with:
- Timestamp (milliseconds)
- Random string (for uniqueness)
- Original file extension

## Troubleshooting

**"Upload failed" error:**
- Check that the `images` bucket exists
- Verify bucket is set to public
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set correctly

**"Image URL not supported" during generation:**
- This means the image URLs aren't publicly accessible
- Check bucket public access policy
- Try accessing an image URL directly in your browser

**Images not showing in preview:**
- Check browser console for errors
- Verify file types are valid images (jpg, png, webp, etc.)
