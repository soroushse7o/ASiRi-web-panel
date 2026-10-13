export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { scheduleSelfBoot } = await import("./lib/self-boot")
  scheduleSelfBoot()
}
