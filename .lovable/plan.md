## Re-publish to fix blank published site

The live site at `gotospecialclass.lovable.app` is serving a stripped `index.html` (no `<head>`, no script tags). This is leftover from the failed build before `src/lib/contractFeasibility.ts` was added. The repo is now correct, but the deployed bundle was never replaced.

Lovable's publish dialog showing "up to date" likely means it thinks no new commit needs deploying. The fix is to call `preview_ui--publish` directly to force a fresh build + deploy. Title, meta description, OG, and Twitter tags in `index.html` are already correct, so no metadata edits are needed.

Steps:
1. Call `preview_ui--publish` with `website_info_status: already_relevant`.
2. Wait ~1 min, then the live URL should render the app.