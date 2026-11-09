/** Next invokes this for both `next start` and standalone servers. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const { validateRuntimeEnv } = await import('./lib/server-env');
      validateRuntimeEnv();
    } catch (error) {
      console.error('Runtime startup validation failed:', error);
      // Next catches instrumentation rejections and can leave the server listening.
      // Terminate directly so invalid runtime configuration always fails closed.
      process.exit(1);
    }
  }
}
