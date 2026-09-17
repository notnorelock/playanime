/**
 * Generate version info.
 *
 * Two sources, in order of preference:
 *   1. GIT_COMMIT_HASH/GIT_COMMIT_COUNT/GIT_BRANCH/GIT_COMMIT_DATE env vars,
 *      if all four are set — this is what a Docker build uses. `.dockerignore`
 *      deliberately excludes `.git` from the build context (keeps the image
 *      small and the build cache meaningful), so `git rev-parse` etc. below
 *      always fail inside a container — silently producing the "dev" /
 *      "unknown" / commitCount 0 fallback for every production deploy, with
 *      no error visible anywhere a deploy would surface it. See
 *      infrastructure/docker/deploy.sh, which computes these on the host
 *      (where a real .git checkout exists) and passes them through as
 *      `docker build --build-arg`s, and the Dockerfiles, which forward them
 *      into this script's environment for the `bun run build` step.
 *   2. Plain `git` commands against this checkout, for local dev
 *      (`bun run dev`/`build` outside Docker, where .git is right there).
 */

import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function fromEnv() {
  const commitHash = process.env.GIT_COMMIT_HASH
  const commitCount = process.env.GIT_COMMIT_COUNT
  const branch = process.env.GIT_BRANCH
  const commitDate = process.env.GIT_COMMIT_DATE

  if (!commitHash || !commitCount || !branch || !commitDate) return null

  return { commitHash, commitCount, branch, commitDate }
}

function fromGit() {
  // Any of these throwing (no .git, e.g. inside a Docker build) means this
  // source is unavailable — let the caller fall through, don't fall back to
  // "dev"/"unknown" ourselves here, since the env-var source above may
  // still have real values.
  const commitHash = execSync('git rev-parse --short HEAD').toString().trim()
  const commitCount = execSync('git rev-list --count HEAD').toString().trim()
  const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
  const commitDate = execSync('git log -1 --format=%ci').toString().trim().split(' ')[0]

  return { commitHash, commitCount, branch, commitDate }
}

const outputPath = join(__dirname, '..', 'public', 'version.json')

let source
try {
  source = fromEnv() ?? fromGit()
} catch (error) {
  console.error('Failed to generate version info:', error.message)

  const fallbackVersion = {
    version: 'dev',
    commitHash: 'unknown',
    commitCount: 0,
    branch: 'unknown',
    buildTime: new Date().toISOString()
  }
  writeFileSync(outputPath, JSON.stringify(fallbackVersion))
  console.log('✓ Fallback version info generated')
  process.exit(0)
}

const { commitHash, commitCount, branch, commitDate } = source

// Build version string: YYYY.MM.D.[commitNumber]-[commitHash]
const [year, month, day] = commitDate.split('-')
const dayWithoutLeadingZero = parseInt(day).toString()
const version = `${year}.${month}.${dayWithoutLeadingZero}.${commitCount}-${commitHash}`

const versionInfo = {
  version,
  commitHash,
  commitCount: parseInt(commitCount),
  branch,
  buildTime: new Date().toISOString(),
  commitDate
}

writeFileSync(outputPath, JSON.stringify(versionInfo))
console.log('✓ Version info generated:', versionInfo.version)
