/**
 * Optional macOS notarization hook for electron-builder.
 * Runs only when APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID are set.
 * Without secrets, packaging still succeeds (unsigned or ad-hoc signed).
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('notarize: skipping (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set)')
    return
  }

  // Dynamic import so CI without notarize tooling still builds.
  let notarize
  try {
    ;({ notarize } = require('@electron/notarize'))
  } catch {
    console.warn('notarize: @electron/notarize not installed — skip')
    return
  }

  const appName = context.packager.appInfo.productFilename
  console.log(`notarize: submitting ${appName}.app…`)
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId
  })
  console.log('notarize: complete')
}
