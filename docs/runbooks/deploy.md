# Deploy

Draft is a static SPA hosted at `draft.jaetill.com` on S3 + CloudFront. Auto-deploys via `.github/workflows/deploy.yml` on push to `master`.

## Manual deploy

```sh
npm install
npm run build

aws s3 sync dist/ s3://jaetill-draft/ --delete
aws cloudfront create-invalidation --distribution-id E29VATR5EV095C --paths "/index.html"
```

## Rollback

```sh
git revert <bad-sha>
git push origin master
```

CloudFront caches invalidate within ~30 seconds. SPA fallback (403/404 → /index.html) handles route changes.