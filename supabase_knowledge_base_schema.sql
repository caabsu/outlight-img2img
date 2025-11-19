-- Supabase table schema for Knowledge Bases
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT, -- Optional short description
  content TEXT NOT NULL, -- The actual knowledge/instructions
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created_at ON knowledge_bases(created_at DESC);

-- Enable RLS
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;

-- Policy (Public for MVP)
CREATE POLICY "Enable all access for knowledge_bases" ON knowledge_bases
  FOR ALL
  USING (true)
  WITH CHECK (true);
