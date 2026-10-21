const io = require('socket.io-client');
const { exec } = require('child_process');
const robot = require('@jitsi/robotjs');
const fs = require('fs');
const path = require('path');

// Point this to your live Render URL (e.g., https://onrender.com)
//const CLOUD_SERVER_URL = "http://localhost:3000";
const CLOUD_SERVER_URL = "https://remotesc.onrender.com/"; 

const socket = io(CLOUD_SERVER_URL, {
    query: { role: 'host' },
    reconnectionAttempts: 10,
    reconnectionDelay: 5000
});

// Save frame file directly inside your local project space rather than AppData\Temp
const localFramePath = path.join(__dirname, 'frame.jpg');

console.log("⚡ Establishing secure outbound tunnel to cloud relay...");

socket.on('connect', () => {
    console.log("✅ Successfully linked to Cloud Relay Server.");
});

// BYPASS DEVICE GUARD: Native Windows API Capture Stream via Inline Memory Compilation
function takeNativeBypassScreenshot() {
    return new Promise((resolve, reject) => {
        const csharpCode = `
        using System;
        using System.Runtime.InteropServices;
        using System.Drawing;
        using System.Drawing.Imaging;
        public class ScreenCapture {
            [DllImport(\\"user32.dll\\")] public static extern IntPtr GetDesktopWindow();
            [DllImport(\\"user32.dll\\")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
            [DllImport(\\"user32.dll\\")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
            [DllImport(\\"user32.dll\\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
            [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
            [DllImport(\\"gdi32.dll\\")] public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);
            public static void Capture(string path) {
                IntPtr hWnd = GetDesktopWindow();
                IntPtr hDC = GetWindowDC(hWnd);
                RECT rect;
                GetWindowRect(hWnd, out rect);
                int width = rect.Right - rect.Left;
                int height = rect.Bottom - rect.Top;
                Bitmap bmp = new Bitmap(width, height);
                using (Graphics g = Graphics.FromImage(bmp)) {
                    IntPtr hgDC = g.GetHdc();
                    BitBlt(hgDC, 0, 0, width, height, hDC, 0, 0, 0x00CC0020);
                    g.ReleaseHdc(hgDC);
                }
                bmp.Save(path, ImageFormat.Jpeg);
                bmp.Dispose();
                ReleaseDC(hWnd, hDC);
            }
        }`.replace(/\n/g, ' ').replace(/\s+/g, ' ');

        const psCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -TypeDefinition '${csharpCode}' -ReferencedAssemblies 'System.Drawing'; [ScreenCapture]::Capture('${localFramePath.replace(/\\/g, '\\\\')}');"`;

        exec(psCommand, (error) => {
            if (error) return reject(error);
            
            fs.readFile(localFramePath, (readErr, data) => {
                if (readErr) return reject(readErr);
                
                fs.unlink(localFramePath, () => {});
                resolve(data);
            });
        });
    });
}

let isProcessingFrame = false;

// Continuously stream native frames out to the cloud server
setInterval(async () => {
    if (isProcessingFrame || !socket.connected) return;
    isProcessingFrame = true;

    try {
        const imgBuffer = await takeNativeBypassScreenshot();
        socket.emit('screen-data-stream', imgBuffer.toString('base64'));
    } catch (err) {
        console.error("❌ Native bypass frame drop:", err.message);
    } finally {
        isProcessingFrame = false;
    }
}, 250); // Set to 250ms interval to keep resource load low under Device Guard checking loops

// Input actions execution listeners
socket.on('execute-click', (data) => {
    try {
        if (data && typeof data.x === 'number' && typeof data.y === 'number') {
            robot.moveMouse(data.x, data.y);
            robot.mouseClick();
        }
    } catch (err) {
        console.error("❌ Click execution error:", err.message);
    }
});

socket.on('execute-type', (data) => {
    try {
        if (data && data.key) {
            if (data.modifier) {
                robot.keyToggle(data.modifier, 'down');
                robot.keyTap(data.key);
                robot.keyToggle(data.modifier, 'up');
            } else {
                robot.keyTap(data.key);
            }
        }
    } catch (err) {
        console.error("❌ Keyboard execution error:", err.message);
    }
});

socket.on('disconnect', () => {
    console.log("⚠️ Connection broken with Cloud Relay.");
});
