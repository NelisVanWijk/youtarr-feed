export function GET(request: Request) {
  return Response.redirect(new URL('/tv/index.html', request.url), 307);
}
