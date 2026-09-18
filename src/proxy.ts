import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/cron/publish authenticates itself via CRON_SECRET (Vercel Cron has no
// Supabase session to send) - without this exemption, Vercel Cron's request would
// get redirected to /login before the route's own check ever ran, and the whole
// publishing queue would silently never fire. /api/unsubscribe and /unsubscribed
// are clicked from an email by someone who was never logged in at all.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/cron", "/api/unsubscribe", "/unsubscribed"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // /login is public so an unauthenticated visitor can reach it, but "public" was
  // being read as "anyone", so someone already signed in got the sign-in form -
  // underneath a header showing their own email and a Sign out button, which is
  // what this looked like live. /auth/callback is deliberately excluded: it has to
  // run its code exchange even when a session already exists.
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
