import { NextResponse, type NextRequest } from "next/server";

/** Simple password on the owner dashboard. */
export function middleware(req: NextRequest) {
  const user = process.env.DASHBOARD_USER || "owner";
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return new NextResponse("Set DASHBOARD_PASSWORD to open the dashboard.", { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [u, ...rest] = atob(encoded).split(":");
    if (u === user && rest.join(":") === pass) return NextResponse.next();
  }
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Owner dashboard"' } });
}

export const config = { matcher: ["/dashboard/:path*"] };
