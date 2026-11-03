import { NextResponse, type NextRequest } from "next/server"

/**
 * The API's session and XSRF cookies are issued for "localhost", and the dev
 * server only trusts localhost for hot reload. Opening the app on 127.0.0.1
 * would break sign-in, so send those visits to the same URL on localhost.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? ""

  if (host === "127.0.0.1" || host.startsWith("127.0.0.1:")) {
    const protocol = request.headers.get("x-forwarded-proto") ?? "http"
    const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `${protocol}://${host.replace("127.0.0.1", "localhost")}`)
    return NextResponse.redirect(target, 307)
  }

  return NextResponse.next()
}

export const config = {
  // Pages only; static assets and dev endpoints are left alone.
  matcher: ["/((?!_next/|favicon.ico).*)"],
}
