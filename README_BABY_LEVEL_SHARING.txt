Baby Diary v2.0 Baby-level Sharing

Sharing is now per baby, not per whole account.

Expected behavior:
- If Person 1 shares Baby A, Person 2 only receives Baby A.
- Baby B on Person 1's phone stays private until shared separately.
- If Person 2 adds their own Baby B, Person 1 does not see it.
- People with access are listed per baby.
- Removing a shared baby removes it only from that phone.

Supabase:
Run SUPABASE_BABY_LEVEL_SHARING_SETUP.sql in Supabase SQL Editor.
The app now uses:
- baby_snapshots
- baby_invite_codes
