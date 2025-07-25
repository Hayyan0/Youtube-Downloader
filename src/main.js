const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');


const store = new Store();

const ytdlpDir = path.join(process.env.LOCALAPPDATA, 'YTDLP');
const ytdlpPath = path.join(ytdlpDir, 'yt-dlp.exe');

let mainWindow;
let loginWindow;
let ytdlpProcess = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 600,
    minWidth: 450,
    minHeight: 500,
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
    checkYtdlpStatus();
  });
};

autoUpdater.on('update-available', (info) => {
  log.info('Update available.', info);
  mainWindow.webContents.send('app-update-available', info);
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded.', info);
  mainWindow.webContents.send('app-update-downloaded', info);
});

autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater. ' + err);
});


function checkYtdlpStatus() {
  const found = fs.existsSync(ytdlpPath);
  mainWindow.webContents.send('ytdlp-status', { found });
  if (found) {
    checkForYtdlpUpdate();
  }
}

function checkForYtdlpUpdate() {
  try {
    const fileBuffer = fs.readFileSync(ytdlpPath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    const localHash = hashSum.digest('hex');
    const sumsUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS';

    const followSumsRedirects = (url, redirectCount = 0) => {
      if (redirectCount > 10) {
        console.error('Too many redirects while trying to fetch SHA2-256SUMS.');
        return;
      }

      const request = https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          followSumsRedirects(response.headers.location, redirectCount + 1);
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
                console.log(`Update available. Local: ${localHash}, Remote: ${remoteHash}`);
                mainWindow.webContents.send('ytdlp-update-available');
              } else {
                console.log('yt-dlp is up to date.');
              }
            }
          });
        } else {
          console.error(`Failed to get SHA2-256SUMS, status code: ${response.statusCode}`);
        }
      });

      request.on('error', (err) => {
        console.error('Failed to download SHA2-256SUMS:', err.message);
      });
    };

    followSumsRedirects(sumsUrl);

  } catch (error) {
    console.error('Error checking for yt-dlp update:', error.message);
  }
}


app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('minimize-app', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('maximize-app', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.on('close-app', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall();
});


ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  return filePaths[0];
});

ipcMain.on('open-login-window', (event) => {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  loginWindow.loadURL('https://www.youtube.com');

  loginWindow.on('closed', async () => {
    const youtubeCookies = await loginWindow.webContents.session.cookies.get({ domain: '.youtube.com' });

    if (youtubeCookies.length > 0) {
      const netscapeCookies = youtubeCookies.map(cookie => {
        const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
        return [
          domain, 'TRUE', cookie.path, cookie.secure ? 'TRUE' : 'FALSE',
          cookie.expirationDate ? Math.round(cookie.expirationDate) : '0',
          cookie.name, cookie.value,
        ].join('\t');
      }).join('\n');

      store.set('youtube-cookies', netscapeCookies);
      mainWindow.webContents.send('login-complete');
    }
    loginWindow = null;
  });
});

ipcMain.on('download-ytdlp', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  downloadYtdlp(win);
});

function downloadYtdlp(win) {
  const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  win.webContents.send('ytdlp-dependency-download-start');

  try {
    if (!fs.existsSync(ytdlpDir)) {
      fs.mkdirSync(ytdlpDir, { recursive: true });
    }
    const file = fs.createWriteStream(ytdlpPath);

    const followRedirects = (url, redirectCount = 0) => {
      if (redirectCount > 10) {
        win.webContents.send('ytdlp-dependency-download-error', 'Too many redirects.');
        return;
      }

      const request = https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          followRedirects(response.headers.location, redirectCount + 1);
          request.abort();
        } else if (response.statusCode === 200) {
          const totalBytes = parseInt(response.headers['content-length'], 10);
          let receivedBytes = 0;

          response.pipe(file);

          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              const progress = (receivedBytes / totalBytes) * 100;
              win.webContents.send('ytdlp-dependency-download-progress', progress);
            }
          });

          file.on('finish', () => {
            file.close(() => {
              win.webContents.send('ytdlp-dependency-download-finished');
              checkYtdlpStatus();
            });
          });
        } else {
          win.webContents.send('ytdlp-dependency-download-error', `Download failed with status code: ${response.statusCode}`);
          file.close();
          fs.unlink(ytdlpPath, () => { });
        }
      });

      request.on('error', (err) => {
        fs.unlink(ytdlpPath, () => { });
        win.webContents.send('ytdlp-dependency-download-error', `Request failed: ${err.message}`);
      });
    };

    followRedirects(downloadUrl);

  } catch (error) {
    win.webContents.send('ytdlp-dependency-download-error', `An unexpected error occurred: ${error.message}`);
  }
}


ipcMain.on('start-download', (event, { url, type, quality, outputDir }) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (!fs.existsSync(ytdlpPath)) {
    win.webContents.send('ytdlp-output', `[FATAL] yt-dlp.exe not found at ${ytdlpPath}`);
    win.webContents.send('download-finished', 1);
    checkYtdlpStatus();
    return;
  }

  let args = [];
  const cookiePath = path.join(app.getPath('userData'), 'cookies.txt');

  const cookieData = store.get('youtube-cookies');
  if (cookieData) {
    fs.writeFileSync(cookiePath, cookieData, 'utf-8');
  }

  const commonArgs = [
    '--progress',
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
      args = ['-f', quality, ...commonArgs, url];
      break;
    case 'audio':
      args = ['-x', '--audio-format', 'mp3', '--audio-quality', quality, ...commonArgs, url];
      break;
    case 'thumbnail':
      const thumbArgs = commonArgs.filter(arg => arg !== '--progress');
      args = ['--write-thumbnail', '--skip-download', ...thumbArgs, url];
      break;
  }

  if (ytdlpProcess) {
    ytdlpProcess.kill();
  }

  ytdlpProcess = spawn(ytdlpPath, args);

  ytdlpProcess.stdout.on('data', (data) => {
    win.webContents.send('ytdlp-output', data.toString());
  });

  const rlErr = readline.createInterface({ input: ytdlpProcess.stderr });
  rlErr.on('line', (line) => {
    const errorLine = line.toLowerCase();
    if (errorLine.includes('private video') || errorLine.includes('login to view this video') || errorLine.includes('sign in')) {
      win.webContents.send('ytdlp-cookie-error');
      if (ytdlpProcess) ytdlpProcess.kill();
    }
    win.webContents.send('ytdlp-output', `[STDERR] ${line}`);
  });

  ytdlpProcess.on('close', (code) => {
    win.webContents.send('download-finished', code);
    ytdlpProcess = null;
    if (fs.existsSync(cookiePath)) {
      fs.unlinkSync(cookiePath);
    }
  });

  ytdlpProcess.on('error', (err) => {
    win.webContents.send('ytdlp-output', `[FATAL] Failed to start yt-dlp process: ${err.message}`);
    win.webContents.send('download-finished', 1);
    ytdlpProcess = null;
  });
});