Baby Diary v2.0 Cloud Sharing Test Build

WHAT IS INCLUDED
- Supabase cloud snapshot sync
- Invite code table
- "Pozovi drugog roditelja"
- "Imam kod"
- Shared family diary connection
- Toast when cloud data changes
- Basic polling every 7 seconds
- Import/export from v1.3 remains included

SETUP
1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run SUPABASE_CLOUD_SHARING_SETUP.sql.
4. In Vercel project settings add environment variables:
   SUPABASE_URL = your Supabase project URL
   SUPABASE_ANON_KEY = your Supabase anon public key
5. Redeploy the project on Vercel.

IMPORTANT BETA NOTE
This version uses open anonymous RLS policies for testing invite-code flow.
For production, this must be hardened with authenticated users or private access tokens.
