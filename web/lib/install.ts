import "server-only"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { AETHER_DIR } from "./aether"

const run = promisify(execFile)
// AETHER_VERSION (set in the Dockerfile) pins the in-panel installer to the same release as the image.
const PINNED = /^v?[0-9A-Za-z][0-9A-Za-z._-]*$/.test(process.env.AETHER_VERSION ?? "") ? process.env.AETHER_VERSION : null
const RELEASE_BASE = PINNED
  ? `https://github.com/CluvexStudio/Aether/releases/download/${PINNED}/`
  : "https://github.com/CluvexStudio/Aether/releases/latest/download/"

function assetName() {
  if (process.platform !== "linux") throw new Error(`سیستم‌عامل ${process.platform} پشتیبانی نمی‌شود`)
  if (process.arch === "x64") return "aether-linux-x86_64-musl.tar.gz"
  if (process.arch === "arm64") return "aether-linux-aarch64-musl.tar.gz"
  throw new Error(`معماری ${process.arch} پشتیبانی نمی‌شود`)
}

async function download(url: string) {
  const res = await fetch(url, { redirect: "follow", cache: "no-store" })
  if (!res.ok) throw new Error(`دانلود ${url} ناموفق بود (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

export async function installAether() {
  const asset = assetName()
  const [archive, checksumFile] = await Promise.all([
    download(RELEASE_BASE + asset),
    download(RELEASE_BASE + asset + ".sha256"),
  ])

  const expected = checksumFile.toString("utf8").trim().split(/\s+/)[0]?.toLowerCase()
  const actual = createHash("sha256").update(archive).digest("hex")
  if (!expected || expected !== actual) throw new Error("checksum فایل دانلودشده مطابقت ندارد")

  await mkdir(AETHER_DIR, { recursive: true })
  const archivePath = path.join(AETHER_DIR, asset)
  await writeFile(archivePath, archive)
  await run("tar", ["-xzf", archivePath, "-C", AETHER_DIR])
  await rm(archivePath, { force: true })

  const bin = path.join(AETHER_DIR, "aether")
  await chmod(bin, 0o755)
  const { stdout } = await run(bin, ["--version"]).catch(() => ({ stdout: "" }))
  return { path: bin, sha256: actual, version: stdout.trim() || null }
}
