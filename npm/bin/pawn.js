#!/usr/bin/env node
'use strict'

/**
 * Pawn installer runner — used by `npx @parkjangwon/pawn` and the globally
 * installed `pawn` command.
 *
 * 1. Resolves the latest tagged release from GitHub.
 * 2. Downloads the installer for the current OS/arch into ~/.pawn/installers/.
 * 3. Launches it (cached copies are reused for the same release).
 *
 * Deliberately dependency-free so the wrapper runs on plain Node 16+.
 */

const { spawn } = require('child_process')
const { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, statSync } = require('fs')
const { homedir } = require('os')
const { join } = require('path')
const https = require('https')

const REPO = 'parkjangwon/pawn'
const CACHE_DIR = join(homedir(), '.pawn', 'installers')
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const DOWNLOAD_URL = `https://github.com/${REPO}/releases/download`
const USER_AGENT = 'pawn-installer-runner'

function packageVersion() {
  return require('../package.json').version
}

/** Map OS/arch to the artifact name produced by electron-builder. */
function artifactName(version, platform, arch) {
  switch (platform) {
    case 'darwin':
      return `pawn-${version}-universal.dmg`
    case 'win32':
      return `pawn-${version}-${arch === 'arm64' ? 'arm64' : 'x64'}-setup.exe`
    case 'linux':
      return `pawn-${version}-${arch === 'arm64' ? 'arm64' : 'x64'}.AppImage`
    default:
      return null
  }
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`GitHub API returned HTTP ${res.statusCode}`))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch (err) {
            reject(new Error(`Invalid JSON from GitHub API: ${err.message}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => req.destroy(new Error('Timed out contacting the GitHub API')))
  })
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': USER_AGENT }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          file.destroy()
          reject(new Error(`Download failed with HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
      }
    )
    req.on('error', (err) => {
      file.destroy()
      reject(err)
    })
    file.on('error', (err) => {
      req.destroy()
      reject(err)
    })
    req.setTimeout(120_000, () => req.destroy(new Error('Timed out downloading the installer')))
  })
}

function launchInstaller(file, platform) {
  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      const child = spawn('open', [file], { stdio: 'ignore', detached: true })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`open exited with code ${code}`))
      })
      return
    }
    if (platform === 'linux') {
      try {
        chmodSync(file, 0o755)
      } catch (err) {
        reject(new Error(`Could not make installer executable: ${err.message}`))
        return
      }
    }
    const child = spawn(file, [], { stdio: 'ignore', detached: true })
    child.on('error', reject)
    child.unref()
    resolve()
  })
}

async function main() {
  const platform = process.platform
  const arch = process.arch

  let tag = null
  try {
    const release = await httpsGetJson(API_URL)
    tag = typeof release.tag_name === 'string' ? release.tag_name : null
  } catch (err) {
    console.warn(`Could not reach GitHub API (${err.message}); falling back to package version.`)
  }
  if (!tag) tag = `v${packageVersion()}`

  const version = tag.replace(/^v/, '')
  const artifact = artifactName(version, platform, arch)
  if (!artifact) {
    console.error(`Pawn has no prebuilt installer for ${platform} (${arch}).`)
    console.error(`Download it manually from https://github.com/${REPO}/releases/latest`)
    process.exitCode = 1
    return
  }

  mkdirSync(CACHE_DIR, { recursive: true })
  const dest = join(CACHE_DIR, artifact)

  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`Using cached installer: ${dest}`)
  } else {
    const url = `${DOWNLOAD_URL}/${tag}/${artifact}`
    const tmp = `${dest}.part`
    console.log(`Downloading ${url}`)
    await downloadFile(url, tmp)
    renameSync(tmp, dest)
    console.log(`Saved to ${dest}`)
  }

  console.log(`Launching Pawn ${version} installer...`)
  try {
    await launchInstaller(dest, platform)
  } catch (err) {
    console.error(`Failed to launch installer: ${err.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}

module.exports = { artifactName, CACHE_DIR }
