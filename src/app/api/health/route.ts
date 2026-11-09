/** Liveness only; exposes no database or authentication state. */
export function GET() {
  return Response.json({ status: 'ok' });
}
