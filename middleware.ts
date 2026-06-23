import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_SESSION_VALUE } from "@/lib/auth";

const protectedPaths = ["/cad", "/api/cad"];

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isLoggedIn = request.cookies.get(AUTH_COOKIE_NAME)?.value === AUTH_SESSION_VALUE;

  if (isProtected && !isLoggedIn) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && isLoggedIn) {
    const cadUrl = request.nextUrl.clone();
    cadUrl.pathname = "/cad";
    cadUrl.search = "";
    return NextResponse.redirect(cadUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/cad/:path*", "/api/cad/:path*", "/login"]
};
