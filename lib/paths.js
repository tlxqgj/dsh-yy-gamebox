import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** DSH 数据根目录：优先环境变量，其次 ~/.dsh */
export function dshHome() {
  const fromEnv = String(process.env.DSH_HOME || '').trim()
  if (fromEnv) return fromEnv
  return path.join(os.homedir(), '.dsh')
}

export function dataDir() {
  return path.join(dshHome(), 'yy-gamebox')
}

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  return dir
}

export function dirOfModule(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl))
}
