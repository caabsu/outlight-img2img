-- Supabase schema for lightweight user profiles, preferences, and usage
-- Run in Supabase SQL editor

-- Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL, -- device/browser identifier
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Graphic Designer','Catalog Manager','Video Editor','Creative Strategist','Admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_client ON user_profiles(client_id);

-- Preferences (one per profile)
CREATE TABLE IF NOT EXISTS user_preferences (
  profile_id UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  selected_kb_id TEXT,
  variation_count INTEGER DEFAULT 3,
  assistant_thread JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Aggregated usage by model per profile
CREATE TABLE IF NOT EXISTS profile_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  total_calls BIGINT DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_usage_profile_model ON profile_usage(profile_id, model_id);

-- RLS (open for MVP)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_usage ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_profile ON usage_events(profile_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model_id);
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for user_profiles" ON user_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for user_preferences" ON user_preferences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for profile_usage" ON profile_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for usage_events" ON usage_events FOR ALL USING (true) WITH CHECK (true);
