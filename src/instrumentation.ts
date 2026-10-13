export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startProctorCleanupScheduler } = await import("@/lib/data/proctoring");
    startProctorCleanupScheduler();
  }
}
