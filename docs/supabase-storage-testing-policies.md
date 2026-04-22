# Supabase Storage Testing Policies

This app currently uses Firebase Auth, not Supabase Auth.

That means:

- the browser talks to Supabase Storage with the public anon key
- Supabase sees these requests as the `anon` role unless a Supabase session exists
- client-side `createSignedUrl()` can only work if the active role has `select` on `storage.objects`

Official Supabase docs confirm:

- private buckets require RLS for downloads and signed URLs
- `createSignedUrl()` requires `select` on `storage.objects`
- `list()` also requires `select` on `storage.objects`

Because of that, **this testing setup cannot fully guarantee “signed-URL-only” access or zero listing capability at the storage layer**. With no Supabase auth bridge and no server-side signer, the same `select` permission needed for signed URLs also enables other object reads for that role.

This is acceptable for a temporary test phase, but not for production.

## Recommended Testing Policies

Run these in the Supabase SQL editor for the private `majuu-files` bucket.

```sql
drop policy if exists "majuu_files_insert_client_testing" on storage.objects;
drop policy if exists "majuu_files_select_client_testing" on storage.objects;

create policy "majuu_files_insert_client_testing"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'majuu-files'
  and (
    (
      (storage.foldername(name))[1] = 'requests'
      and (
        (
          (storage.foldername(name))[3] = 'attachments'
          and array_length(storage.foldername(name), 1) = 4
        )
        or
        (
          (storage.foldername(name))[3] = 'chat'
          and array_length(storage.foldername(name), 1) = 5
        )
      )
    )
    or
    (
      (storage.foldername(name))[1] = 'users'
      and (
        (
          (storage.foldername(name))[3] = 'self_help'
          and array_length(storage.foldername(name), 1) = 6
        )
        or
        (
          (storage.foldername(name))[3] = 'profile'
          and (storage.foldername(name))[4] = 'avatar'
          and array_length(storage.foldername(name), 1) = 4
        )
      )
    )
  )
);

create policy "majuu_files_select_client_testing"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'majuu-files'
  and (
    (
      (storage.foldername(name))[1] = 'requests'
      and (
        (
          (storage.foldername(name))[3] = 'attachments'
          and array_length(storage.foldername(name), 1) = 4
        )
        or
        (
          (storage.foldername(name))[3] = 'chat'
          and array_length(storage.foldername(name), 1) = 5
        )
      )
    )
    or
    (
      (storage.foldername(name))[1] = 'users'
      and (
        (
          (storage.foldername(name))[3] = 'self_help'
          and array_length(storage.foldername(name), 1) = 6
        )
        or
        (
          (storage.foldername(name))[3] = 'profile'
          and (storage.foldername(name))[4] = 'avatar'
          and array_length(storage.foldername(name), 1) = 4
        )
      )
    )
  )
);
```

## What Each Policy Does

### `majuu_files_insert_client_testing`

Allows:

- client uploads into the private `majuu-files` bucket
- only for the canonical MAJUU path families:
  - `requests/{id}/attachments/...`
  - `requests/{id}/chat/...`
  - `users/{uid}/self_help/...`
  - `users/{uid}/profile/avatar/...`

Blocks:

- uploads into other buckets
- uploads into random non-contract paths inside `majuu-files`

Why required:

- Supabase Storage denies uploads by default without an `insert` policy
- this keeps chat, request documents, self-help documents, and profile photos working

### `majuu_files_select_client_testing`

Allows:

- `createSignedUrl()` from the client for files in the same canonical path families
- runtime access resolution through `fileAccessService`
- chat/request/self-help/profile/admin/staff views to open files from storage metadata

Blocks:

- reads outside `majuu-files`
- reads outside the approved contract paths

Why required:

- private-bucket signed URLs need `select`
- your current resolver uses `createSignedUrl()` at runtime, so without this policy the UI cannot open files

## What We Are Intentionally Not Adding

- no public bucket access
- no bucket listing policies
- no `update`
- no `delete`

That keeps the surface smaller for this phase.

## Important Limitation For This Stage

This setup is **test-ready**, not **production-secure**.

Why:

- Supabase docs require `select` for both `createSignedUrl()` and `list()`
- without Supabase auth, all browser storage requests are effectively `anon`
- so Supabase cannot distinguish “user A”, “user B”, “admin”, or “staff” yet

In other words:

- the app UI is using signed URLs correctly
- the bucket is still private
- but storage-layer ownership enforcement is not truly complete until you add either:
  - a Supabase auth bridge, or
  - a server-side signed URL layer
