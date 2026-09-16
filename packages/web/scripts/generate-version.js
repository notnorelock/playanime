/**
 * Generate version info from git
 * Creates a version.json file with commit hash and count
 */

import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

try {
  // Get git commit hash (short)
  const commitHash = execSync('git rev-parse --short HEAD')
    .toString()
    .trim()

  // Get git commit count
  const commitCount = execSync('git rev-list --count HEAD')
    .toString()
    .trim()

  // Get git branch
  const branch = execSync('git rev-parse --abbrev-ref HEAD')
    .toString()
    .trim()

  // Get commit date (YYYY-MM-DD format)
  const commitDate = execSync('git log -1 --format=%ci')
    .toString()
    .trim()
    .split(' ')[0] // Extract just the date part

  // Parse commit date to get year, month, day
  const [year, month, day] = commitDate.split('-')
  const dayWithoutLeadingZero = parseInt(day).toString()

  // Build version string: YYYY.MM.D.[commitNumber]-[commitHash]
  const version = `${year}.${month}.${dayWithoutLeadingZero}.${commitCount}-${commitHash}`

  // Get build timestamp
  const buildTime = new Date().toISOString()

  const versionInfo = {
    version,
    commitHash,
    commitCount: parseInt(commitCount),
    branch,
    buildTime,
    commitDate
  }

  // Write to public directory
  const outputPath = join(__dirname, '..', 'public', 'version.json')
  writeFileSync(outputPath, JSON.stringify(versionInfo))

  console.log('✓ Version info generated:', versionInfo.version)
} catch (error) {
  console.error('Failed to generate version info:', error.message)

  // Fallback version info
  const fallbackVersion = {
    version: 'dev',
    commitHash: 'unknown',
    commitCount: 0,
    branch: 'unknown',
    buildTime: new Date().toISOString()
  }

  const outputPath = join(__dirname, '..', 'public', 'version.json')
  writeFileSync(outputPath, JSON.stringify(fallbackVersion))

  console.log('✓ Fallback version info generated')
}
