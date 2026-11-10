import { createDownloadHandler } from '@/lib/export-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createDownloadHandler();
