const { dialog } = require("electron");
const sharp = require('sharp');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const Vibrant = require('node-vibrant');
const Lumberjack = require('./lumberjack.js');
const fileFilter = require('./fileFilter.js');

const jack = new Lumberjack();

class imageEditor {
    constructor (args) {
        this.fp = args.fp;
    }
    dataToBuffer(dataURI) {
        return new Buffer.from(dataURI.split(",")[1], 'base64');
    }
    rotateImage(file, direction, event, win) {
        sharp(this.dataToBuffer(file))
            .rotate(direction == "right" ? 90 : -90)
            .toBuffer()
            .then(data => {
                this.fp.process(`data:image/png;base64,${data.toString('base64')}`, event);
                win.show();
            })
            .catch( err => {
                jack.log(err);
                event.sender.send('action', "Failed to rotate image");
            });
    }
    saveImage (file, event, win) {
        dialog.showSaveDialog(win, {
            title: "Save image",
            defaultPath: this.fp.name,
            filters: fileFilter.save
        }).then(result => {
            if (result.canceled) return;

            let filePath = result.filePath;
            var ext = filePath.substr(filePath.lastIndexOf(".") + 1);

            sharp(this.dataToBuffer(file))
                .toFormat(ext)
                .toFile(filePath)
                .then(info => {
                    event.sender.send('action', "Image saved!");
                })
                .catch( err => {
                    jack.log(err);
                    event.sender.send('action', "Failed to save image");
                });
        }).catch(err => {
            jack.log(err);
            event.sender.send('action', "Failed to save image");
        });
    }
    flipImage(file, direction, event, win) {
        let output = sharp(this.dataToBuffer(file))

        if (direction == "horizontal") output.flop();
        else output.flip();

        output.toBuffer()
        .then(data => {
            this.fp.process(`data:image/png;base64,${data.toString('base64')}`, event);
            win.show();
        })
        .catch( err => {
            jack.log(err);
            event.sender.send('action', "Failed to rotate image");
        });
    }
    getPalette(file, event, win) {
        if (this.fp.generatedPalette) return event.sender.send('palette', this.fp.generatedPalette);

        let filePath = path.join(os.tmpdir(), 'out.png');
        fs.writeFile(filePath, this.dataToBuffer(file), 'base64', err => {
            if (err) return jack.log(err);

            Vibrant.from(filePath).getPalette().then((palette) => {
                this.fp.generatedPalette = palette;
                event.sender.send('palette', palette);
            });
        });
    }
    edit(file, type, event, win) {
        switch (type) {
            case "rotateRight":
                this.rotateImage(file, "right", event, win);
                break;
            case "rotateLeft":
                this.rotateImage(file, "left", event, win);
                break;
            case "flipVertical":
                this.flipImage(file, "vertical", event, win);
                break;
            case "flipHorizontal":
                this.flipImage(file, "horizontal", event, win);
                break;
            case "getPalette":
                this.getPalette(file, event, win);
                break;
            case "save":
                this.saveImage(file, event, win);
                break;
            default: break;
        }
    }
}

module.exports = imageEditor;