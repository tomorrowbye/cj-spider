import { createMcpHandler } from '@/lib/mcp/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createMcpHandler();
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
