-- Supabase table schema for saved generated images
-- Run this SQL in your Supabase SQL Editor to create the table

CREATE TABLE IF NOT EXISTS saved_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  image_data TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model_name TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT,
  reference_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_saved_images_created_at ON saved_images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_images_product_id ON saved_images(product_id);
CREATE INDEX IF NOT EXISTS idx_saved_images_model_name ON saved_images(model_name);

-- Enable Row Level Security (RLS)
ALTER TABLE saved_images ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your auth needs)
-- For MVP, allowing anonymous access similar to products and prompts
CREATE POLICY "Enable all access for saved_images" ON saved_images
  FOR ALL
  USING (true)
  WITH CHECK (true);
