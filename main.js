const { app, BrowserWindow, ipcMain, dialog, screen } = require("electron");

const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const fileFilter = require('./scripts/main/fileFilter.js');
const recentsProcessor = require('./scripts/main/recentsProcessor.js');
const settingsProcessor = require('./scripts/main/settingsProcessor.js');
const Lumberjack = require('./scripts/main/lumberjack.js');
const windowManager = require('./scripts/main/windowManager.js');
const fileProcessor = require('./scripts/main/fileProcessor.js');
const imageEditor = require('./scripts/main/imageEditor.js');

const jack = new Lumberjack();
let mainWindow, newWin;
let sp, rp, wm, fp, ie;
let processorsReady = false;

let gotTheLock;
let wmReady = false;

sp = new settingsProcessor({
    home: path.join(os.homedir(), '.refviewer'),
    filename: 'config.json',
    ready: () => {
        rp = new recentsProcessor({
            home: path.join(os.homedir(), '.refviewer'),
            filename: 'recents.json',
            ready: () => {
                wm = new windowManager({
                    rp: rp,
                    sp: sp,
                    ready: () => {
                        wmReady = true;
                    }
                });
                
                fp = new fileProcessor({
                    rp: rp
                });

                ie = new imageEditor( {
                    fp: fp
                });
            }
        });
    }
});

try {
    require("electron-reloader")(module);
} catch (_) {}

gotTheLock = app.requestSingleInstanceLock();

function createWhenReady() {
    if (!wmReady) setTimeout(createWhenReady, 100);
    else return wm.createWindow();
}

if (!gotTheLock) {
    app.quit();
} else {
    app.on("ready", createWhenReady);
}

app.on("window-all-closed", function () {
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", function () {
    if (wm.windows.length <= 0) createWhenReady();
});    

ipcMain.on('settings:write', (event, arg) => {
    sp.writeSettings(arg, () => {
        event.sender.send('settings', sp.settings);
    });
});

ipcMain.on('window', (event, arg) => {
    let senderID = event.sender.id;
    let activeWindow = wm.getWindowByID(senderID);

    if (!activeWindow) return;
    switch (arg) {
        case "pin":
            if (activeWindow.isAlwaysOnTop()) activeWindow.setAlwaysOnTop(false);
            else activeWindow.setAlwaysOnTop(true);
            event.sender.send('pin', activeWindow.isAlwaysOnTop());
            break;
        case "close":
            activeWindow.close();
            break;
        case "maximize":
            if (activeWindow.isMaximized()) activeWindow.unmaximize();
            else activeWindow.maximize();
            break;
        case "minimize":
            activeWindow.minimize();
            break;
        case "new":
            wm.createWindow();
            break;
        default: break;
    }
});

ipcMain.on('file', (event, arg) => {
    fp.process(arg, event);
    if (newWin) newWin.close();
});

ipcMain.on('action', (event, arg) => {
    event.sender.send('action', arg);
});

ipcMain.on('loading', (event, arg) => {
    event.sender.send('loading', arg);
});

ipcMain.on('editImage', (event, arg) => {
    let activeWindow = wm.getWindowByID(event.sender.id);
    
    if (!activeWindow) return;
    if (!arg.image) return;

    ie.edit(arg.image, arg.type, event, activeWindow);
});

ipcMain.on('selectfile', (event, arg) => {
    let senderID = event.sender.id;
    let activeWindow = wm.getWindowByID(senderID);
    
    if (!activeWindow) return;
    dialog.showOpenDialog(activeWindow, {
        title: "Open image",
        filters: fileFilter.open
    }).then(result => {
        if (!result.cancelled && result.filePaths.length > 0) {
            let files = result.filePaths;
            fp.process(files[0], event);
        }
    }).catch(err => {
        jack.log(err);
    });
});

ipcMain.on('screenshot', (event, arg) => {
    let senderID = event.sender.id;
    let activeWindow = wm.getWindowByID(senderID);
    
    if (!activeWindow) return;
    let windowPOS = activeWindow.getPosition();

    let currentScreen = screen.getDisplayNearestPoint({
        x: windowPOS[0],
        y: windowPOS[1]
    });

    let allDisplays = screen.getAllDisplays();
    let index = allDisplays.map(e => e.id).indexOf(currentScreen.id);;
    activeWindow.hide();

    screenshot.listDisplays().then((displays) => {

        screenshot({
            screen: displays[index].id,
            filename: path.join(os.tmpdir(), 'screenshot.png')
        }).then((imgPath) => {
            impath = imgPath;

            activeWindow.show();
            
            newWin = new BrowserWindow({
                x: currentScreen.bounds.x,
                y: currentScreen.bounds.y,
                width: currentScreen.size.width,
                height: currentScreen.size.height,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                },
                frame:false,
                show: false
            });

            newWin.loadFile('public/screen.html');

            newWin.once('ready-to-show', () => {
                newWin.show();
                newWin.setFullScreen(true);
                newWin.focus();

                ipcMain.once('image_crop', (e, arg) => {
                    if (newWin) newWin.close();

                    sharp(impath)
                        .extract({ left: arg.x, top: arg.y, width: arg.w, height: arg.h })
                        .toBuffer()
                        .then( data => {
                            fp.process(`data:image/png;base64,${data.toString('base64')}`, event);
                            activeWindow.show();
                        })
                        .catch( err => {
                            jack.log(err);
                        });
                });
            });

            newWin.on('close', function(e){
                newWin = null;
            });
        }).catch((error) => {
            jack.log("error", error);
            event.sender.send('action', "Failed to take a screenshot");
        });
    });
});