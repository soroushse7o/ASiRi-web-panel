import { Dashboard } from "@/components/dashboard"
import { getFullStatus } from "@/lib/status"

export const dynamic = "force-dynamic"

export default function Page() {
  return <Dashboard initialStatus={getFullStatus()} />
}
