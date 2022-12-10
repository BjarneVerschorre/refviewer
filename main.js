const { app, BrowserWindow, ipcMain, dialog, screen } = require("electron");

const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const fileFilter = require('./scripts/main/fileFilter.js');
const recentsProcessor = require('./scripts/main/recentsProcessor.js');
const settingsProcessor = require('./scripts/main/settingsProcessor.js');
const windowManager = require('./scripts/main/windowManager.js');
const fileProcessor = require('./scripts/main/fileProcessor.js');
const historyProcessor = require('./scripts/main/historyProcessor.js');
const imageEditor = require('./scripts/main/imageEditor.js');
const Lumberjack = require('./scripts/main/lumberjack.js');

let mainWindow, newWin;
let sp, rp, wm, fp, ie, hp;
let processorsReady = false;

let gotTheLock;
let wmReady = false;

const homeDir = path.join(os.homedir(), '.refviewer');

const jack = new Lumberjack();

sp = new settingsProcessor({
    home:homeDir,
    filename: 'config.json',
    ready: () => {
        rp = new recentsProcessor({
            home: homeDir,
            filename: 'recents.json'
        });

        wm = new windowManager({
            rp: rp,
            sp: sp,
            ready: () => {
                wmReady = true;
            }
        });

        hp = new historyProcessor({
            limit: 15
        });
        
        fp = new fileProcessor({
            rp: rp,
            hp: hp
        });

        ie = new imageEditor({
            fp: fp
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
            event.sender.send('max', activeWindow.isMaximized());
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

ipcMain.on('getRecents', (event, arg) => {
    rp.readRecents((data) => {
        event.sender.send('recents', data);
    });
});

ipcMain.on('clearRecents', (event, arg) => {
    rp.clearRecents((data) => {
        event.sender.send('recents', data);
    });
});

ipcMain.on('file', (event, arg) => {
    hp.flush();
    fp.process(arg, event);
    if (newWin) newWin.close();
});

ipcMain.on('action', (event, arg) => {
    event.sender.send('action', arg);
});

ipcMain.on('loading', (event, arg) => {
    event.sender.send('loading', arg);
});

ipcMain.on('undo', (event, arg) => {
    hp.undo(event, (file) => {
        fp.process(file, event, true, false);
    });
});

ipcMain.on('select:saveDirectory', (event, arg) => {
    let senderID = event.sender.id;
    let activeWindow = wm.getWindowByID(senderID);
    
    if (!activeWindow) return;
    dialog.showOpenDialog(activeWindow, {
        title: "Select screenshot directory",
        properties: ['openDirectory']
    }).then(result => {
        if (!result.cancelled && result.filePaths.length > 0) {
            let files = result.filePaths;

            event.sender.send('getDirectory', files[0]);
            event.sender.send('action', "Selected a directory");
        }
    }).catch(err => {
        jack.log("Error selecting directory: ", err);
    });
});

ipcMain.on('editImage', (event, arg) => {
    let activeWindow = wm.getWindowByID(event.sender.id);
    
    if (!activeWindow) return;
    if (!arg.image) return;

    hp.history(arg.image);

    ie.edit(arg.image, arg.args, arg.type, event, activeWindow);
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
        jack.log("Error opening file: ", err);
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
    let index = allDisplays.map(e => e.id).indexOf(currentScreen.id);

    activeWindow.hide();

    let errTimeout = setTimeout(() => {
        activeWindow.show();
    }, 5000);

    let currentDate = new Date(); 
    let timestamp = currentDate.getDate() + ""
                + (currentDate.getMonth()+1)
                + currentDate.getFullYear() + "-"
                + currentDate.getHours()
                + currentDate.getMinutes()
                + currentDate.getSeconds();

    jack.log("Preparing to take a screenshot...");
    screenshot.listDisplays().then((displays) => {
        jack.log("Listing displays...");
        screenshot({
            screen: displays[index].id,
            format: 'png'
        }).then((img) => {
            jack.log("Took the screenshot!");

            clearTimeout(errTimeout);
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

            newWin.webContents.once('did-finish-load', () => {
                newWin.webContents.send('screenshot', img);
            });

            newWin.once('ready-to-show', () => {
                newWin.show();
                newWin.setFullScreen(true);
                newWin.focus();

                ipcMain.removeAllListeners('image_crop');
                ipcMain.once('image_crop', (e, arg) => {
                    if (newWin) newWin.close();

                    sharp(img)
                        .extract({ left: arg.x, top: arg.y, width: arg.w, height: arg.h })
                        .toBuffer()
                        .then(data => {
                            fp.process(`data:image/png;base64,${data.toString('base64')}`, event);
                            activeWindow.show();

                            if (sp.settings.autosave && sp.settings.savedir) {
                                ie.edit(`data:image/png;base64,${data.toString('base64')}`, {
                                    name: timestamp,
                                    dir: sp.settings.savedir
                                }, "saveAuto", event, activeWindow);
                            }
                        })
                        .catch(err => {
                            jack.log("Error processing screenshot: ", err);
                        });
                });

                ipcMain.removeAllListeners('image_full');
                ipcMain.once('image_full', (e, arg) => {
                    if (newWin) newWin.close();

                    sharp(img)
                        .toBuffer()
                        .then(data => {
                            fp.process(`data:image/png;base64,${data.toString('base64')}`, event);
                            activeWindow.show();

                            if (sp.settings.autosave && sp.settings.savedir) {
                                ie.edit(`data:image/png;base64,${data.toString('base64')}`, {
                                    name: timestamp,
                                    dir: sp.settings.savedir
                                }, "saveAuto", event, activeWindow);
                            }
                        })
                        .catch( err => {
                            jack.log("Error processing screenshot: ", err);
                        });
                });
            });

            newWin.once('close', () => { newWin = null; });
        }).catch((error) => {
            activeWindow.show();

            jack.log("Error screenshotting: ", error);
            event.sender.send('action', "Failed to take a screenshot");
        });
    });
});