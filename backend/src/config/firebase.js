// Firebase Admin has been removed. Persistence is PostgreSQL (see src/db/).
export function initializeFirebase() {
  throw new Error('Firebase is no longer used. Set DATABASE_URL for Supabase Postgres.');
}
