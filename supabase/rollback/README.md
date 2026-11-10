# Supabase Migration Rollback Directory

This directory stores standalone rollback SQL scripts for schema migrations.

## Safety & Migration Discovery Policy
- **Isolation from Forward Migrations**: Files in this directory are deliberately kept outside `supabase/migrations/` so that the Supabase CLI (`supabase migration up`, `supabase db push`) never interprets them as forward migrations.
- **Rollback Packaging**: Each rollback script mirrors the corresponding timestamped forward migration in `supabase/migrations/` and can be manually inspected or executed in reverse if a deployment needs to be cleanly rolled back.

