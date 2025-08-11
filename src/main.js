const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const readline = require('readline');
const os = require('os');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const extract = require('extract-zip');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

autoUpdater.autoDownload = false;

const store = new Store();


function findExecutableInPath(exeName) {
  const systemPath = process.env.PATH || '';
  const pathDirs = systemPath.split(path.delimiter);

  const extensions = (process.platform === 'win32' && process.env.PATHEXT)
    ? process.env.PATHEXT.split(path.delimiter)
    : [''];

  for (const dir of pathDirs) {
    const possibleNames = [exeName];
    if (process.platform === 'win32') {
      const exeNameLower = exeName.toLowerCase();
      if (!extensions.some(ext => exeNameLower.endsWith(ext.toLowerCase()))) {
        extensions.forEach(ext => possibleNames.push(exeName + ext));
      }
    }

    for (const name of possibleNames) {
      const exePath = path.join(dir, name);
      try {
        if (fs.existsSync(exePath)) {
          log.info(`Found ${exeName} in PATH: ${exePath}`);
          return exePath;
        }
      } catch (e) {
        log.error(`Error checking path ${exePath}: ${e}`);
      }
    }
  }

  log.info(`${exeName} not found in system PATH.`);
  return null;
}


const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
const localYtdlpDir = path.join(localAppData, 'YTDLP');
const localYtdlpPath = path.join(localYtdlpDir, 'yt-dlp.exe');
const localFfmpegDir = path.join(localAppData, 'FFMPEG');
const localFfmpegPath = path.join(localFfmpegDir, 'bin', 'ffmpeg.exe');

let ytdlpPath;
let ffmpegPath;


let mainWindow;
let loginWindow;
let ytdlpProcess = null;
let wasManuallyCancelled = false;
let currentDownloadFilePaths = [];

const clearUpdaterCache = () => {
  const updaterCacheDir = path.join(localAppData, 'youtube-downloader-updater');
  log.info(`Checking for updater cache at: ${updaterCacheDir}`);
  try {
    if (fs.existsSync(updaterCacheDir)) {
      log.info('Updater cache directory found. Clearing all contents (files and folders)...');
      fs.readdirSync(updaterCacheDir).forEach((file) => {
        const entryPath = path.join(updaterCacheDir, file);
        fs.rmSync(entryPath, { recursive: true, force: true });
      });
      log.info('Updater cache contents cleared successfully.');
    } else {
      log.info('Updater cache directory not found, no action needed.');
    }
  } catch (error) {
    log.error('Failed to clear updater cache:', error);
  }
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 650,
    minWidth: 450,
    minHeight: 550,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  autoUpdater.checkForUpdates();

  mainWindow.webContents.on('did-finish-load', () => {
    checkDependencies();
  });
};

autoUpdater.on('update-available', (info) => {
  log.info('Update available.', info);
  mainWindow.webContents.send('app-update-available', info);
});

autoUpdater.on('download-progress', (progressInfo) => {
  mainWindow.webContents.send('app-update-progress', progressInfo);
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded.', info);
  mainWindow.webContents.send('app-update-downloaded', info);
});

autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater. ' + err);
});


function checkDependencies() {
  log.info('Checking for dependencies...');
  const ytdlpPathInSystem = findExecutableInPath('yt-dlp.exe');
  const ffmpegPathInSystem = findExecutableInPath('ffmpeg.exe');

  ytdlpPath = ytdlpPathInSystem || localYtdlpPath;
  ffmpegPath = ffmpegPathInSystem || localFfmpegPath;

  const ytdlpExists = fs.existsSync(ytdlpPath);
  const ffmpegExists = fs.existsSync(ffmpegPath);

  log.info(`Using yt-dlp from: ${ytdlpPath} (Exists: ${ytdlpExists})`);
  log.info(`Using ffmpeg from: ${ffmpegPath} (Exists: ${ffmpegExists})`);

  mainWindow.webContents.send('dependencies-status', { ytdlp: ytdlpExists, ffmpeg: ffmpegExists });

  if (ytdlpExists && ytdlpPath === localYtdlpPath) {
    checkForYtdlpUpdate();
  }
}

function checkForYtdlpUpdate() {
  try {
    const fileBuffer = fs.readFileSync(localYtdlpPath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const localHash = hashSum.digest('hex');
    const sumsUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';

    const followRedirects = (url, redirectCount = 0) => {
      if (redirectCount > 10) {
        log.error('Too many redirects while trying to fetch SHA2-256SUMS.');
        return;
      }

      const request = https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          followRedirects(response.headers.location, redirectCount + 1);
          request.abort();
        } else if (response.statusCode === 200) {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => {
            const lines = data.split('\n');
            const exeLine = lines.find(line => line.trim().endsWith('yt-dlp.exe'));
            if (exeLine) {
              const remoteHash = exeLine.trim().split(/\s+/)[0];
              if (localHash.toLowerCase() !== remoteHash.toLowerCase()) {
                log.info(`yt-dlp update available. Local: ${localHash}, Remote: ${remoteHash}`);
                mainWindow.webContents.send('ytdlp-update-available');
              } else {
                log.info('yt-dlp is up to date.');
              }
            }
          });
        } else {
          log.error(`Failed to get SHA2-256SUMS, status code: ${response.statusCode}`);
        }
      });
      request.on('error', (err) => log.error('Failed to download SHA2-256SUMS:', err.message));
    }

    followRedirects(sumsUrl);

  } catch (error) {
    log.error('Error checking for yt-dlp update:', error.message);
  }
}

app.whenReady().then(() => {
  clearUpdaterCache();
  createWindow();
}).catch(err => {
  log.error('Error during app startup:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('minimize-app', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.on('maximize-app', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('close-app', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.on('restart-app', () => autoUpdater.quitAndInstall());
ipcMain.on('download-app-update', () => autoUpdater.downloadUpdate());

ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});

ipcMain.on('open-login-window', () => {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    parent: mainWindow,
    modal: true,
  });

  loginWindow.loadURL('https://www.youtube.com/account');

  const handleLoginCheck = async () => {
    if (!loginWindow || loginWindow.isDestroyed()) return;

    try {
      const youtubeCookies = await loginWindow.webContents.session.cookies.get({ domain: '.youtube.com' });
      const isLoggedIn = youtubeCookies.some(c => ['SID', 'HSID', 'SSID'].includes(c.name));

      if (isLoggedIn) {
        log.info('YouTube login detected. Storing cookies.');
        store.set('youtube-cookies-raw', youtubeCookies);

        mainWindow.webContents.send('login-complete');

        if (loginWindow && !loginWindow.isDestroyed()) {
          loginWindow.close();
        }
      }
    } catch (error) {
      log.error('Failed to check/get cookies from login window:', error);
    }
  };

  loginWindow.webContents.on('did-finish-load', handleLoginCheck);

  loginWindow.on('closed', () => {
    loginWindow = null;
    log.info('Login window has been closed and variable has been cleared.');
  });
});

async function downloadFile(win, url, savePath, progressDetails) {
  return new Promise((resolve, reject) => {
    let file;
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(win, response.headers.location, savePath, progressDetails).then(resolve).catch(reject);
        request.abort();
        return;
      }
      if (response.statusCode !== 200) {
        request.abort();
        reject(`Download failed with status code: ${response.statusCode}`);
        return;
      }

      file = fs.createWriteStream(savePath);
      const totalBytes = parseInt(response.headers['content-length'], 10);
      let receivedBytes = 0;

      response.pipe(file);

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = (receivedBytes / totalBytes) * 100;
          win.webContents.send('dependencies-download-progress', { percent, details: progressDetails });
        }
      });

      file.on('finish', () => {
        file.close(resolve);
      });

      file.on('error', (err) => {
        fs.unlink(savePath, () => { });
        reject(err.message);
      });
    });

    request.on('error', (err) => {
      if (file) {
        file.close();
      }
      fs.unlink(savePath, () => { });
      reject(`Request failed: ${err.message}`);
    });

    request.on('abort', () => {
      if (file) {
        file.close();
      }
    });
  });
}
ipcMain.on('download-dependencies', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.webContents.send('dependencies-download-start', 'Starting dependency download...');

  try {
    const ffmpegExists = fs.existsSync(localFfmpegPath);
    const ytdlpDownloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    if (!fs.existsSync(localYtdlpDir)) fs.mkdirSync(localYtdlpDir, { recursive: true });
    await downloadFile(win, ytdlpDownloadUrl, localYtdlpPath, 'Downloading yt-dlp.exe...');

    if (!ffmpegExists) {
      const ffmpegDownloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip';
      const ffmpegZipPath = path.join(localFfmpegDir, 'ffmpeg.zip');
      if (!fs.existsSync(localFfmpegDir)) fs.mkdirSync(localFfmpegDir, { recursive: true });

      if (fs.existsSync(ffmpegZipPath)) {
        try {
          fs.unlinkSync(ffmpegZipPath);
        } catch (e) {
          log.error(`Could not delete existing ffmpeg.zip: ${e}`);
        }
      }

      await downloadFile(win, ffmpegDownloadUrl, ffmpegZipPath, 'Downloading FFmpeg...');

      win.webContents.send('dependencies-download-progress', { percent: 100, details: 'Extracting FFmpeg...' });
      await extract(ffmpegZipPath, { dir: localFfmpegDir });

      const nestedFolderName = 'ffmpeg-master-latest-win64-gpl-shared';
      const nestedFolderPath = path.join(localFfmpegDir, nestedFolderName);
      if (fs.existsSync(nestedFolderPath)) {
        const files = fs.readdirSync(nestedFolderPath);
        for (const file of files) {
          fs.renameSync(path.join(nestedFolderPath, file), path.join(localFfmpegDir, file));
        }
        fs.rmdirSync(nestedFolderPath);
      }

      fs.unlinkSync(ffmpegZipPath);
    }

    win.webContents.send('dependencies-download-finished');
    checkDependencies();
  } catch (error) {
    log.error('Dependency download error:', error);
    win.webContents.send('dependencies-download-error', error.toString());
  }
});

ipcMain.on('cancel-download', () => {
  if (ytdlpProcess && ytdlpProcess.pid) {
    log.info(`Cancellation request received. Terminating process tree for PID: ${ytdlpProcess.pid}.`);
    wasManuallyCancelled = true;

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${ytdlpProcess.pid} /f /t`);
        log.info('Process tree termination signal sent via taskkill.');
      } else {
        ytdlpProcess.kill('SIGKILL');
      }
    } catch (e) {
      log.error(`Failed to send kill signal: ${e.message}`);
    }

    if (mainWindow) {
      mainWindow.webContents.send('download-cancelled');
    }
  }
});


ipcMain.on('start-download', (event, { url, type, quality, outputDir }) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!fs.existsSync(ytdlpPath) || !fs.existsSync(ffmpegPath)) {
    win.webContents.send('ytdlp-output', `[FATAL] Dependencies missing.`);
    win.webContents.send('download-finished', 1);
    checkDependencies();
    return;
  }

  wasManuallyCancelled = false;
  currentDownloadFilePaths = [];
  let args = [];
  const cookiePath = path.join(app.getPath('userData'), 'cookies.txt');

  const rawCookies = store.get('youtube-cookies-raw');
  if (rawCookies && Array.isArray(rawCookies) && rawCookies.length > 0) {
    const header = '# Netscape HTTP Cookie File' + os.EOL;
    const cookieLines = rawCookies.map(c => {
      return [c.domain, 'TRUE', c.path, c.secure ? 'TRUE' : 'FALSE', c.expirationDate ? Math.round(c.expirationDate) : '0', c.name, c.value].join('\t');
    });
    const netscapeCookies = header + cookieLines.join(os.EOL) + os.EOL;
    fs.writeFileSync(cookiePath, netscapeCookies, 'utf-8');
    log.info(`Wrote ${rawCookies.length} cookies to ${cookiePath}`);
  } else {
    if (fs.existsSync(cookiePath)) {
      fs.unlinkSync(cookiePath);
    }
  }

  const commonArgs = [
    '--progress',
    '--no-playlist',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    '--geo-bypass',
    '--no-mtime',
    '-o', `${outputDir}/%(title)s [%(id)s].%(ext)s`
  ];

  if (fs.existsSync(cookiePath)) {
    commonArgs.push('--cookies', cookiePath);
  }

  switch (type) {
    case 'video':
      args = [
        '-f', quality,
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', path.dirname(ffmpegPath),
        ...commonArgs,
        url
      ];
      break;
    case 'audio':
      args = [
        '-x', '--audio-format', 'mp3',
        '--audio-quality', quality,
        '--ffmpeg-location', path.dirname(ffmpegPath),
        ...commonArgs,
        url
      ];
      break;
    case 'thumbnail':
      const thumbBaseArgs = commonArgs.filter(arg => arg !== '--progress');
      args = ['--write-thumbnail', '--skip-download', ...thumbBaseArgs, url];
      break;
  }

  if (ytdlpProcess) {
    ytdlpProcess.kill();
  }

  ytdlpProcess = spawn(ytdlpPath, args);

  const stdHandler = (data) => {
    const output = data.toString();
    win.webContents.send('ytdlp-output', output);

    const destRegex = /\[download\] Destination: (.*)/;
    const mergeRegex = /\[Merger\] Merging formats into "(.*?)"/;
    const thumbRegex = /\[info\] Writing video thumbnail to: (.*)/;

    output.split('\n').forEach(line => {
      line = line.trim();
      let filePath = null;

      const destMatch = line.match(destRegex);
      if (destMatch && destMatch[1]) filePath = destMatch[1];

      const mergeMatch = line.match(mergeRegex);
      if (mergeMatch && mergeMatch[1]) filePath = mergeMatch[1];

      const thumbMatch = line.match(thumbRegex);
      if (thumbMatch && thumbMatch[1]) filePath = thumbMatch[1];

      if (filePath && !currentDownloadFilePaths.includes(filePath)) {
        currentDownloadFilePaths.push(filePath);
        log.info(`Tracking file for potential cleanup: ${filePath}`);
      }
    });
  };

  ytdlpProcess.stdout.on('data', stdHandler);

  const rlErr = readline.createInterface({ input: ytdlpProcess.stderr });
  rlErr.on('line', (line) => {
    const errorLine = line.toLowerCase();
    if (errorLine.includes('private video') || errorLine.includes('login to view this video') || errorLine.includes('sign in')) {
      win.webContents.send('ytdlp-cookie-error');
      if (ytdlpProcess) ytdlpProcess.kill();
    }
    stdHandler(`[STDERR] ${line}`);
  });

  ytdlpProcess.on('close', (code) => {
    if (wasManuallyCancelled) {
      log.info('Download was cancelled by user. Cleaning up files and suppressing "download-finished" event.');

      const filesToDelete = [];
      currentDownloadFilePaths.forEach(filePath => {
        filesToDelete.push(filePath);
        filesToDelete.push(`${filePath}.part`);
      });

      const uniqueFilesToDelete = [...new Set(filesToDelete)];

      uniqueFilesToDelete.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            log.info(`Deleted file on cancellation: ${filePath}`);
          } catch (unlinkErr) {
            log.error(`Failed to delete file ${filePath}:`, unlinkErr);
          }
        }
      });

    } else {
      win.webContents.send('download-finished', code);
    }

    ytdlpProcess = null;
    currentDownloadFilePaths = [];
    wasManuallyCancelled = false;
  });

  ytdlpProcess.on('error', (err) => {
    if (wasManuallyCancelled) return;
    win.webContents.send('ytdlp-output', `[FATAL] Failed to start yt-dlp process: ${err.message}`);
    win.webContents.send('download-finished', 1);
    ytdlpProcess = null;
  });
});
