import { bootOnce } from "@/lib/boot"

export const dynamic = "force-dynamic"

// Called once by instrumentation.ts (self-request) after the server is up. Idempotent.
export function POST() {
  return Response.json(bootOnce())
}
