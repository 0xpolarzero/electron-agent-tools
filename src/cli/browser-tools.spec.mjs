import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', '..')
const electronBin = (() => {
  if (process.platform === 'win32') {
    const exePath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    return exePath
  }
  return path.join(root, 'node_modules/.bin/electron')
})()
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

let built = false
const buildOnce = async () => {
  if (built) return
  await execFileAsync(pnpmBin, ['build'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' },
    shell: process.platform === 'win32', // Node 20+: .cmd requires shell on Windows
  })
  built = true
}

const run = async (cmd, args, opts = {}) =>
  execFileAsync(cmd, args, {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' },
    ...opts,
  })

const findLatestArtifact = async (filename, dir = '.e2e-artifacts') => {
  const artifactRoot = path.join(root, dir)
  const entries = await readdir(artifactRoot).catch(() => [])
  let latestPath = null
  let latestMtime = 0
  for (const entry of entries) {
    const candidate = path.join(artifactRoot, entry, filename)
    try {
      const st = await stat(candidate)
      if (st.isFile() && st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs
        latestPath = candidate
      }
    } catch {
      // ignore
    }
  }
  return latestPath
}

const runBrowserTool = (sub, payload) =>
  run('node', [path.join(root, 'dist/cli/browser-tools.js'), sub, JSON.stringify(payload)]).then(
    (res) => JSON.parse(res.stdout),
  )

const loadLib = () => import(pathToFileURL(path.join(root, 'dist/index.js')).href)

test(
  'browser-tools subcommands, artifacts, and window helpers',
  { concurrency: false },
  async () => {
    await buildOnce()
    const { launchElectron, connectAndPick } = await loadLib()
    const disposables = []

    try {
      const launch = await launchElectron({
        command: electronBin,
        args: [path.join(root, 'fixtures/main.js')],
        artifactPrefix: 'cli-spec',
      })
      disposables.push(() => launch.quit())

      const wsUrl = launch.wsUrl

      // wait-text and click
      await runBrowserTool('wait-text', { wsUrl, text: 'click button', timeoutMs: 15000 })
      await runBrowserTool('click', { wsUrl, testid: 'click-button' })
      await runBrowserTool('wait-text', { wsUrl, text: 'Select a folder', timeoutMs: 15000 })

      // type + press enter on input
      await runBrowserTool('type', {
        wsUrl,
        testid: 'name-input',
        value: 'hello',
        clearFirst: true,
      })
      await runBrowserTool('press', { wsUrl, key: 'Enter', testid: 'name-input' })
      await runBrowserTool('wait-text', { wsUrl, text: 'pressed enter', timeoutMs: 10000 })

      // hover updates text
      await runBrowserTool('hover', { wsUrl, testid: 'hover-target' })
      await runBrowserTool('wait-text', { wsUrl, text: 'hovered', timeoutMs: 10000 })

      // list-windows
      const windows = await runBrowserTool('list-windows', { wsUrl })
      assert.ok(windows.ok, `list-windows failed: ${JSON.stringify(windows)}`)
      assert.ok(windows.data.pages.length >= 1)

      // list-selectors
      const selectors = await runBrowserTool('list-selectors', { wsUrl })
      assert.ok(selectors.data.testIds.includes('click-button'))

      // screenshot artifact (defaults to run dir)
      await runBrowserTool('screenshot', { wsUrl, fullPage: true })
      await access(path.join(root, '.e2e-artifacts/cli-spec/page.png'))

      // scroll into view sets scroll-status
      await runBrowserTool('scroll-into-view', { wsUrl, testid: 'far-target' })
      const scrollStatus = await runBrowserTool('get-dom', {
        wsUrl,
        css: '#scroll-status',
        as: 'textContent',
      })
      assert.strictEqual(scrollStatus.data.value.trim(), 'scrolled')

      // upload
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'e2e-'))
      const uploadFile = path.join(tmpDir, 'upload.txt')
      await writeFile(uploadFile, 'hello')
      await runBrowserTool('upload', { wsUrl, testid: 'file-input', filePath: uploadFile })
      const uploadEcho = await runBrowserTool('get-dom', {
        wsUrl,
        testid: 'file-output',
        as: 'textContent',
      })
      assert.strictEqual(uploadEcho.data.value.trim(), 'upload.txt')

      // open new window and switch to it
      await runBrowserTool('click', { wsUrl, testid: 'open-window' })
      const waited = await runBrowserTool('wait-for-window', {
        wsUrl,
        pick: { titleContains: 'Second' },
        timeoutMs: 15000,
      })
      assert.ok(waited.data.url.includes('second.html'))

      const switched = await runBrowserTool('switch-window', {
        wsUrl,
        pick: { titleContains: 'Second' },
      })
      assert.ok(switched.data.title.includes('Second'))

      // dump-dom artifact
      const domDump = await runBrowserTool('dump-dom', { wsUrl, selector: '#title' })
      assert.strictEqual(domDump.ok, true)

      // world-aware helpers and tracing
      const driver = await connectAndPick({
        wsUrl,
        pick: { titleContains: 'Mini' },
        runLogPath: launch.runLogPath,
      })
      disposables.push(() => driver.close())
      const bridgeProbe = await driver.evalInRendererMainWorld(() => ({
        ready: Boolean(globalThis.__eatBridgeReady__),
        hasBridge: Boolean(globalThis.eatBridge),
      }))
      assert.deepStrictEqual(bridgeProbe, { ready: true, hasBridge: true })
      await driver.waitForBridge(20000)

      await driver.injectGlobals({ injectedFoo: 'bar' }, { persist: true })
      const snapshots = await driver.snapshotGlobals(['injectedFoo', 'preloadMarker'], {
        worlds: ['renderer', 'preload', 'isolated'],
      })
      const rendererSnap = snapshots.find((s) => s.world === 'renderer')
      assert.strictEqual(rendererSnap?.values?.injectedFoo, 'bar')
      const markerWorlds = snapshots.filter(
        (s) => s.values && s.values.preloadMarker === 'from-preload',
      )
      assert.ok(markerWorlds.length >= 1, 'preloadMarker captured in at least one world')

      await driver.evalInRendererMainWorld(() => console.log('renderer-log-marker'))
      await driver.evalInPreload(() => console.log('preload-log-marker'))

      await driver.evalInPreload((msg) => globalThis.eatPing(msg), 'hello-trace')
      await driver.evalInRendererMainWorld(() =>
        fetch('http://127.0.0.1:0/e2e-log').catch(() => 'failed'),
      )

      const inspectorUrl = await driver.getRendererInspectorUrl()
      assert.ok(inspectorUrl.startsWith('devtools://'))

      // reload-friendly wait
      await driver.evalInRendererMainWorld(() => window.location.reload())
      await driver.waitForTextAcrossReloads('click button', {
        timeoutMs: 15000,
        perAttemptTimeoutMs: 5000,
      })

      // CLI snapshot + IPC harvest
      const snapshotCli = await runBrowserTool('snapshot-globals', {
        wsUrl,
        names: ['injectedFoo'],
      })
      assert.strictEqual(snapshotCli.ok, true)

      // confirm artifacts exist under run dir
      const domDumpFile = await findLatestArtifact('dom-dump.html')
      assert.ok(domDumpFile, 'dom-dump artifact present')

      await new Promise((resolve) => setTimeout(resolve, 500))
      const runLog = await readFile(launch.runLogPath, 'utf-8')
      assert.match(runLog, /\[system\] \[info\] run-start/, 'run-start logged')
      assert.match(runLog, /\[stdout\] \[info\].*main-ready/, 'stdout captured')
      assert.match(
        runLog,
        /\[(preload|renderer)\] \[(log|info)\].*preload-ready/,
        'preload console captured',
      )
      assert.match(
        runLog,
        /\[renderer\] \[(log|info)\].*fixture-loaded/,
        'renderer console captured',
      )
      assert.match(runLog, /\[ipc\] \[info\].*eat-ping/, 'ipc trace captured')
      assert.match(runLog, /\[network\] \[warn\].*e2e-log/, 'network events captured')
      assert.match(runLog, /\[screenshot\] \[info\].*page\.png/, 'screenshot logged')
      assert.match(runLog, /\[domdump\] \[info\].*dom-dump/, 'dom dump logged')

      const lastRun = path.join(root, '.e2e-artifacts/last-run')
      const lastRunTarget = await realpath(lastRun)
      assert.strictEqual(
        lastRunTarget,
        path.resolve(launch.artifactDir),
        'last-run points to run dir',
      )
      await access(path.join(lastRunTarget, 'dom-dump.html'))
    } finally {
      for (const dispose of disposables.reverse()) {
        try {
          await dispose()
        } catch {
          // ignore cleanup errors
        }
      }
    }
  },
)

test('launch-electron CLI start/quit', { concurrency: false }, async () => {
  await buildOnce()

  const payload = {
    command: electronBin,
    args: [path.join(root, 'fixtures/main.js')],
    artifactPrefix: 'cli-launch',
  }

  const start = await run('node', [
    path.join(root, 'dist/cli/launch-electron.js'),
    'start',
    JSON.stringify(payload),
  ])
  const startJson = JSON.parse(start.stdout)
  assert.strictEqual(startJson.ok, true)
  assert.ok(startJson.data.wsUrl)
  assert.ok(startJson.data.pid)

  const quit = await run('node', [
    path.join(root, 'dist/cli/launch-electron.js'),
    'quit',
    JSON.stringify({
      launchFile: startJson.data.launchFile,
      pid: startJson.data.electronPid ?? startJson.data.pid,
    }),
  ])
  const quitJson = JSON.parse(quit.stdout)
  assert.strictEqual(quitJson.ok, true)
})
