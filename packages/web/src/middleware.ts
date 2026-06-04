import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // If the user is trying to access an admin route
  if (request.nextUrl.pathname.startsWith('/admin')) {
    // Check if they have an access token in cookies
    // Note: since our token is currently stored in localStorage (client-side), 
    // the server middleware cannot read it easily unless we set it as a cookie too.
    // For now, we'll let the client-side AuthContext handle the redirect if missing.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
