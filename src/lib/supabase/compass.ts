import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

const ALLOWED_COMPASS_SCHEMAS = new Set(["public", "compass"]);

function getDefaultCompassSchema() {
  return process.env.NODE_ENV === "production" ? "compass" : "public";
}

export function getCompassDbSchema() {
  const defaultSchema = getDefaultCompassSchema();
  const configuredSchema = process.env.COMPASS_DB_SCHEMA?.trim() || defaultSchema;

  if (!ALLOWED_COMPASS_SCHEMAS.has(configuredSchema)) {
    console.warn(
      `Unsupported COMPASS_DB_SCHEMA "${configuredSchema}". Falling back to ${defaultSchema}.`
    );
    return defaultSchema;
  }

  return configuredSchema;
}

export function createCompassServiceClient(): SupabaseClient<any, any, any> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    if (process.env.NODE_ENV === "production") {
      return createClient("https://dummy.supabase.co", "dummy-key", {
        db: { schema: getCompassDbSchema() },
        auth: { persistSession: false },
      });
    }

    throw new Error("Supabase environment variables are not configured.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    db: { schema: getCompassDbSchema() },
    auth: { persistSession: false },
  });
}

export function createCompassBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase public environment variables are not configured. Using a dummy Compass client.");
    return createBrowserClient("https://dummy.supabase.co", "dummy-key", {
      db: { schema: getCompassDbSchema() },
    });
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: getCompassDbSchema() },
  });
}
