// @flow

import { IpfsConnector, ipfsEvents, ConnectorState } from '@michaelmure/ipfs-connector'
import { BrowserWindow, ipcMain, app } from 'electron'
import path from 'path'

/*
 * Note: This is hacky and will bite me in the future.
 *
 * IpfsConnector is designed to run on the main electron process because
 * it needs to spawn the ipfs daemon and only the main process is able to
 * do that.
 *
 * Here, we actually have TWO instance of IpfsConnector. The first one
 * is on the main process and deal with the lifecycle of the daemon.
 * The second one is in the electron renderer process. It simply get
 * spawned when using IpfsConnector.getInstance() from the renderer.
 * As the memory is completely separated, the singleton pattern fail to
 * see that there is already another instance and spawn a second one.
 *
 * However, the second instance does not known about the the daemon
 * lifecycle and calls to the API probably work by pure chance as I don't
 * think it was engineered to be used like this.
 *
 * I added some IPC message to inform the renderer process of when the
 * API is available. This is a shortcut.
 *
 * The real solution could be to have the redux store and the logic in
 * the main process, with something to sync the store to the renderer
 * process. This will be needed to have a systray icon and to be able
 * to close the main window. But this is left for my future self or
 * as an exercice for the reader.
 */


let serviceStarted = false

export const isServiceStarted = 'is-ipfs-started'
export const getServiceStatus = 'get-service-status'

export const start = () => {
  const instance = IpfsConnector.getInstance()

  const userData = app.getPath('userData')

  console.log('Application data path: ' + userData)

  // set the download path for ipfs
  instance.setBinPath(userData)

  // set the ipfs repository path
  instance.setIpfsFolder(path.join(userData, '/repo'))

  instance.setOption('args', [
    'daemon',
    '--enable-pubsub-experiment',
    '--enable-namesys-pubsub'
  ])

  instance.enableDownloadEvents()

  // install some event listeners
  instance.on(ipfsEvents.SERVICE_STARTING, onServiceStarting)
  instance.on(ipfsEvents.SERVICE_STARTED, onServiceStarted)
  instance.on(ipfsEvents.UPGRADING_BINARY, onServiceUpgrade)
  instance.on(ipfsEvents.SERVICE_STOPPING, onServiceStopping)
  instance.on(ipfsEvents.SERVICE_FAILED, onServiceFailed)
  instance.on(ipfsEvents.STATUS_UPDATE, onStatusUpdate)
  instance.on(ipfsEvents.DOWNLOAD_PROGRESS, onDownloadProgress)
  instance.on(ipfsEvents.DOWNLOAD_ERROR, onDownloadError)

  // reply when a renderer process ask if ipfs is ready
  ipcMain.on(isServiceStarted, (event) => {
    event.returnValue = serviceStarted
  })

  // reply when a renderer process ask for ipfs status
  ipcMain.on(getServiceStatus, (event) => {
    event.returnValue = instance.serviceStatus.state
  })


  // start ipfs daemon and download binaries if needed
  instance.start()
}

const connectToRelays = async () => {
  console.log('Main: connect to relay ...')

  const instance = IpfsConnector.getInstance()

  const bootstrap = await instance.api.apiClient.config.get('Bootstrap')

  await Promise.all(
    bootstrap.map(
      async addr => await instance.api.apiClient.swarm.connect(addr)
        .then(() => console.log(addr + ' connected'), () => console.log(addr + ' failed'))
    )
  )
}

const onServiceStarting = async () => {
  console.log('Main: Ipfs service starting')

  serviceStarted = false

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.SERVICE_STARTING))
}

const onServiceStarted = async () => {
  console.log('Main: Ipfs service started')

  serviceStarted = true

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.SERVICE_STARTED))

  try {
    await connectToRelays()
  } catch(err) {
    console.error(err)
  }
}

const onServiceUpgrade = () => {
  console.log('Main: Ipfs service upgrading')

  serviceStarted = false

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.UPGRADING_BINARY))
}

const onServiceStopping = () => {
  console.log('Main: Ipfs service stopping')

  serviceStarted = false

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.SERVICE_STOPPING))
}

const onServiceFailed = () => {
  console.log('Main: Ipfs service failed')

  serviceStarted = false

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.SERVICE_FAILED))
}

const onStatusUpdate = (state) => {
  console.log('Main: Ipfs status update: ' + ConnectorState[state])

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.STATUS_UPDATE, state))
}

const onDownloadProgress = (progress) => {
  console.log(`Main: Ipfs daemon download progress: ${progress.completed} / ${progress.total}`)

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.DOWNLOAD_PROGRESS, progress))
}

const onDownloadError = (error) => {
  console.log(`Main: Ipfs download error: ${error}`)

  // Inform all renderer process
  BrowserWindow.getAllWindows()
    .forEach(win => win.webContents.send(ipfsEvents.DOWNLOAD_ERROR, error))
}

export const stop = () => {
  const instance = IpfsConnector.getInstance()
  instance.stop()
}
