// Where the links in an email point.
//
// Both cron routes used `new URL(request.url).origin`, which is the host that
// happened to invoke them. Locally that is localhost, which is right. On Vercel it is
// whichever deployment the cron fired against, and that is not reliably the address a
// person can use: a deployment-specific URL changes on every deploy, and preview
// deployments sit behind Deployment Protection, so an "Open it here" link can land on
// a login wall instead of the request. An unsubscribe link that does that is worse
// than a broken feature, because failing to unsubscribe someone who asked is the one
// email failure with consequences beyond this app.
//
// So an explicit value wins, then Vercel's own production domain, and the request
// origin is the last resort rather than the only answer.
export function appBaseUrl(request: Request): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  // Set by Vercel on every deployment: the project's stable production host, with no
  // protocol, and the same value on a preview deployment as on production.
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;

  return new URL(request.url).origin;
}
