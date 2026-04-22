# Storage Contract

This app now enforces a single upload gateway and canonical storage paths.

## Upload Gateway

- Only [`uploadBinaryFile`](../src/services/fileUploadService.js) can upload files.
- Direct provider SDK upload calls are not allowed in feature code.
- `uploadBinaryFile` rejects any path that does not match an approved contract.
- `uploadBinaryFile` also rejects uploads when required ownership metadata is missing.

## Canonical Path Contracts

Defined in [`src/services/storageContract.js`](../src/services/storageContract.js):

1. `request_attachment`
- Path shape: `requests/{requestId}/attachments/{attachmentId}/{ts}_{file}`
- Required metadata: `requestId`, `attachmentId`, `ownerUid`, `source`

2. `chat_attachment`
- Path shape: `requests/{requestId}/chat/{fromRole}/{attachmentKind}/{ts}_{file}`
- Required metadata: `requestId`, `fromRole`, `attachmentKind`, `source`

3. `self_help_document`
- Path shape: `users/{ownerUid}/self_help/{track}/{country}/{recordId}/{ts}_{file}`
- Required metadata: `ownerUid`, `track`, `country`, `recordId`, `source`

4. `profile_image`
- Path shape: `users/{ownerUid}/profile/avatar/{ts}_{file}`
- Required metadata: `ownerUid`, `source`

## Ownership Rules

- Request attachments are owned by the requesting user (`ownerUid`), scoped to a request.
- Chat attachments are scoped to a request and sender role (`fromRole`).
- Self-help documents are private to the owner user path (`users/{ownerUid}/...`).
- Profile photos are private user-owned assets stored under `users/{ownerUid}/profile/...`.

## Current Callers

- Request uploads: [`src/services/attachmentservice.js`](../src/services/attachmentservice.js)
- Chat uploads: [`src/services/chatservice.js`](../src/services/chatservice.js)
- Self-help uploads: [`src/selfHelp/SelfHelpDocumentsScreen.jsx`](../src/selfHelp/SelfHelpDocumentsScreen.jsx)
- Profile photo uploads: [`src/services/profilePhotoService.js`](../src/services/profilePhotoService.js)

## Private Bucket Access

- `storageBucket` + `storagePath` are the canonical file reference for bucket-backed uploads.
- Stored `externalUrl` values are legacy compatibility only and should not be written for new bucket-backed uploads.
- Runtime file opening now goes through [`src/services/fileAccessService.js`](../src/services/fileAccessService.js), which:
- Creates signed URLs for private Supabase objects
- Resolves Firebase download URLs from `storagePath`
- UI callers should use [`src/components/FileAccessLink.jsx`](../src/components/FileAccessLink.jsx) or [`src/components/FileAccessImage.jsx`](../src/components/FileAccessImage.jsx) instead of hardcoding saved URLs.
