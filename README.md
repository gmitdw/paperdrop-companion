# PaperDrop companion

A small Home Screen app for capturing receipts, searching the shared collection,
and submitting review changes through OneDrive. Files are saved on the device
before delivery. OCR and the PostgreSQL index run on the owner's Windows computer.

## Deployment status

The Microsoft app registration is still pending. The current build saves receipts
locally, but OneDrive delivery is not enabled until `config.json` has the registered
client ID. Do not treat this installation preview as a completed shared deployment.

## Development

Run `npm ci`, `npm test`, and `npm run build`. Copy `dist/` into `docs/` for GitHub
Pages. Register the exact Pages URL (with trailing slash) as a Microsoft SPA
redirect URI supporting personal Microsoft accounts. There is no client secret.
The delegated permission is Files.ReadWrite. The user selects the shared folder.

## Storage and privacy

No receipts, account tokens, database passwords, or collection metadata belong in
this repository. Receipt blobs and queued edits use IndexedDB on each device.
Microsoft sign-in uses MSAL; files transfer directly to the user's OneDrive.
The static host does not receive receipt uploads. GitHub serves the app files and
receives normal web access information under its own privacy policy.

iOS can suspend closed web apps. Offline receipts retry when the app is reopened.
Browser storage can be cleared or evicted; keep the app installed and let receipts
finish delivering. Local receipt copies are retained after delivery.
