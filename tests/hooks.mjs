// Lets plain `node` import the app's TypeScript: stubs "server-only", resolves "@/…" and extensionless imports.
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web")

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
  let target = null
  if (specifier.startsWith("@/")) target = path.join(WEB, specifier.slice(2))
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
  }
  if (target) {
    for (const candidate of [target, `${target}.ts`, path.join(target, "index.ts")]) {
      if (candidate.endsWith(".ts") && existsSync(candidate)) return next(pathToFileURL(candidate).href, context)
    }
  }
  return next(specifier, context)
}
