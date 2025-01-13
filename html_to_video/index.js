// index.js

const express = require('express');
const puppeteer = require('puppeteer-core');
const { spawn, exec, execSync } = require('child_process');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

const setCORSHeaders = (res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Credentials', 'true');
};

const ensurePulseAudio = () => {
  try {
    console.log('Checking if PulseAudio is running...');
    execSync('pulseaudio --check', { stdio: 'ignore' });
    console.log('PulseAudio is running.');
  } catch {
    console.log('PulseAudio not running. Starting PulseAudio...');
    try {
      execSync('pulseaudio --start');
      console.log('PulseAudio started.');
    } catch (error) {
      console.error('Failed to start PulseAudio:', error);
      throw error;
    }
  }

  try {
    console.log('Creating virtual audio sink...');
    execSync('pactl load-module module-null-sink sink_name=virtual_sink', { stdio: 'ignore' });
    console.log('Virtual audio sink created.');
  } catch (error) {
    console.error('Virtual audio sink already exists or failed to create:', error);
  }
};

const killXvfb = () => {
  try {
    console.log('Attempting to kill existing Xvfb instances...');
    execSync('pkill Xvfb', { stdio: 'ignore' });
    console.log('Killed any existing Xvfb instances.');
  } catch (error) {
    console.log('No existing Xvfb instances found or failed to kill:', error);
  }
};

const findAvailableDisplay = () => {
  for (let displayNum = 99; displayNum < 200; displayNum++) {
    try {
      execSync(`xdpyinfo -display :${displayNum} > /dev/null 2>&1`);
      continue; // Display is in use
    } catch (error) {
      // Display not in use
      return `:${displayNum}`;
    }
  }
  throw new Error('No available display numbers found');
};

const launchXvfb = (display, width, height) => {
  const screenSize = `${width}x${height}x24`;
  console.log(`Starting Xvfb on display ${display} with screen size ${screenSize}...`);
  const xvfbProcess = spawn('Xvfb', [display, '-screen', '0', screenSize], {
    stdio: 'ignore',
    detached: true
  });
  xvfbProcess.unref();
  console.log(`Xvfb started on display ${display} with screen size ${screenSize}`);
  return xvfbProcess;
};

const ensureXvfbReady = (display) => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 5;
    const checkInterval = 2000; // 2 seconds interval

    const checkXvfb = () => {
      attempts++;
      console.log(`Checking if Xvfb on display ${display} is ready (Attempt ${attempts}/${maxAttempts})...`);

      try {
        execSync(`xdpyinfo -display ${display} > /dev/null 2>&1`);
        console.log(`Xvfb on display ${display} is confirmed to be ready.`);
        resolve();
      } catch (error) {
        if (attempts < maxAttempts) {
          console.log('Xvfb is not ready yet. Retrying...');
          setTimeout(checkXvfb, checkInterval);
        } else {
          console.error('Xvfb did not become ready after multiple attempts.');
          reject(new Error('Xvfb not ready'));
        }
      }
    };

    checkXvfb();
  });
};

const startBrowserWithRetry = async (executablePath, display, width, height, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempting to launch browser (Attempt ${attempt}/${retries})...`);
      await ensureXvfbReady(display);

      const browser = await puppeteer.launch({
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--disable-gpu', // Disable GPU acceleration
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--no-sandbox',
          '--start-fullscreen',
          `--window-size=${width},${height}`,
          '--window-position=0,0',
          '--disable-blink-features=AutomationControlled',
          `--display=${display}`,
          '--enable-automation',
          '--autoplay-policy=no-user-gesture-required'
        ],
        executablePath,
        headless: false,
        timeout: 90000,
        dumpio: true
      });

      browser.on('disconnected', () => {
        console.error('Browser disconnected unexpectedly.');
      });
      browser.on('targetdestroyed', target => {
        console.log('A target was destroyed:', target.url());
      });
      browser.on('targetchanged', target => {
        console.log('Target changed:', target.url());
      });

      console.log(`Browser launched successfully on attempt ${attempt}.`);
      return browser;
    } catch (error) {
      console.error(`Attempt ${attempt} to launch browser failed: ${error.message}`);
      if (attempt < retries) {
        console.log(`Retrying (${attempt + 1}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        throw error;
      }
    }
  }
};

const setupPage = async (page, width, height, url, delay) => {
    try {
      // Set viewport
      console.log('Setting viewport...');
      await page.setViewport({ width, height });
      console.log('Viewport set.');
  
      // **Initial Page Load for Caching**
      console.log('Navigating to the URL for initial load...');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      console.log('Initial page loaded.');
  
      // Wait for main content on initial load
      console.log('Waiting for main content on initial load...');
      await page.waitForSelector('body', { timeout: 60000 });
      console.log('Main content loaded on initial load.');

  
      // Wait for 5 seconds to cache resources
      console.log('Waiting for 5 seconds to cache resources...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.log('Waited 5 seconds.');
  
      // **Detect Video Element During Initial Load**
      console.log('Checking for video element during initial load...');
      const videoExists = await page.evaluate(() => {
        const video = document.querySelector('video');
        return !!video;
      });
  
      if (videoExists) {
        console.log('Video element found during initial load.');
      } else {
        console.log('No video element found during initial load.');
      }
  
      // **Reload the Page for Actual Recording**
      console.log('Reloading page for actual recording...');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      console.log('Page reloaded.');
  
      // Wait for main content on recording load
      console.log('Waiting for main content on recording load...');
      await page.waitForSelector('body', { timeout: 60000 });
      console.log('Main content loaded on recording load.');
  
  
      // **Simulate User Interaction**
      console.log('Simulating user interaction...');
      await page.keyboard.press(' ');
      console.log('User interaction simulated.');
  
  
      // **Start Video Playback if Video Element Exists**
      if (videoExists) {
        console.log('Video element exists. Attempting to play video...');
        await page.evaluate(() => {
          const video = document.querySelector('video');
          if (video) {
            video.play();
          }
        });
  
        console.log('Video playback started.');
  
        // Wait until the video is playing
        console.log('Waiting for video to start playing...');
        await page.waitForFunction(() => {
          const video = document.querySelector('video');
          return video && !video.paused && !video.ended && video.readyState >= 2;
        }, { timeout: 10000 });
        console.log('Video is now playing.');
      } else {
        console.log('No video element found. Proceeding without video playback.');
      }
  
      // **Request Fullscreen**
      console.log('Requesting fullscreen...');
      await page.evaluate(() => {
        document.documentElement.requestFullscreen();
      });
      console.log('Fullscreen requested.');
  
      // **Delay Before Recording (if any)**
      if (delay > 0) {
        console.log(`Waiting for an additional delay of ${delay} ms before starting recording...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error('Error during page setup:', error);
      throw error;
    }
  };
  
  




const recordVideo = (display, width, height, fps, duration, timestamp) => {
  const videoPath = `/tmp/video_${timestamp}.mp4`;
  const ffmpegCommand = `ffmpeg -f x11grab -draw_mouse 0 -s ${width}x${height} -r ${fps} -i ${display}.0 -f pulse -ac 2 -i virtual_sink.monitor -c:v libx264 -preset ultrafast -b:v 10M -c:a aac -b:a 192k -pix_fmt yuv420p -t ${duration} ${videoPath}`;

  console.log(`Starting video recording with command: ${ffmpegCommand}`);

  return new Promise((resolve, reject) => {
    const ffmpegProcess = exec(ffmpegCommand, (error) => {
      if (error) {
        console.error('FFmpeg process failed:', error);
        reject(error);
      } else {
        console.log('Video recording completed successfully.');
        resolve(videoPath);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpegProcess.stdout.on('data', (data) => {
      console.log(`FFmpeg stdout: ${data}`);
    });
  });
};

const convertToGif = (videoPath, timestamp, fps) => {
  const gifPath = `/tmp/video_${timestamp}.gif`;
  const ffmpegCommand = `ffmpeg -i ${videoPath} -vf "fps=${fps},scale=640:-1:flags=lanczos,palettegen" -y /tmp/palette.png && \
      ffmpeg -i ${videoPath} -i /tmp/palette.png -lavfi "fps=${fps},scale=640:-1:flags=lanczos [x]; [x][1:v] paletteuse" -y ${gifPath}`;

  console.log(`Converting video to GIF with command: ${ffmpegCommand}`);

  return new Promise((resolve, reject) => {
    const ffmpegProcess = exec(ffmpegCommand, (error) => {
      if (error) {
        console.error('FFmpeg process failed during GIF conversion:', error);
        reject(error);
      } else {
        console.log('GIF conversion completed successfully.');
        resolve(gifPath);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpegProcess.stdout.on('data', (data) => {
      console.log(`FFmpeg stdout: ${data}`);
    });
  });
};

const uploadVideo = async (videoPath, timestamp) => {
  try {
    const { size } = fs.statSync(videoPath);
    console.log(`Uploading video ${videoPath} to Google Cloud Storage...`);
    await storage.bucket('html-to-video2').upload(videoPath, { destination: `video_${timestamp}.mp4` });
    console.log('Video uploaded successfully.');
    return (size / (1024 * 1024)).toFixed(2);
  } catch (error) {
    console.error('Error uploading video:', error);
    throw error;
  }
};

const uploadGif = async (gifPath, timestamp) => {
  try {
    const { size } = fs.statSync(gifPath);
    console.log(`Uploading GIF ${gifPath} to Google Cloud Storage...`);
    await storage.bucket('html-to-video2').upload(gifPath, { destination: `video_${timestamp}.gif` });
    console.log('GIF uploaded successfully.');
    return (size / (1024 * 1024)).toFixed(2);
  } catch (error) {
    console.error('Error uploading GIF:', error);
    throw error;
  }
};

app.options('/createVideoFromHtml2', (req, res) => {
  setCORSHeaders(res);
  res.status(204).send('');
});

app.post('/createVideoFromHtml2', async (req, res) => {
  setCORSHeaders(res);
  let xvfbProcess;
  let browser;

  try {
    const { url, duration, fps, width, height, format = 'mp4', delay = 0 } = req.body;

    if (!url || !duration || !fps || !width || !height) {
      res.status(400).send('URL, duration, fps, width, and height are required');
      return;
    }

    console.log(`Received request with URL: ${url}, duration: ${duration}, fps: ${fps}, width: ${width}, height: ${height}, format: ${format}, delay: ${delay}`);

    ensurePulseAudio();
    killXvfb();

    const display = findAvailableDisplay();
    xvfbProcess = launchXvfb(display, width, height);

    const executablePath = '/usr/bin/google-chrome';
    browser = await startBrowserWithRetry(executablePath, display, width, height);
    console.log('Creating new page...');
    const page = await browser.newPage();
    console.log('New page created.');

    page.on('error', (err) => {
      console.error('Page error:', err);
    });

    page.on('pageerror', (err) => {
      console.error('Page uncaught exception:', err);
    });

    page.on('console', msg => {
      console.log(`PAGE LOG [${msg.type()}]: ${msg.text()}`);
    });

    page.on('requestfailed', request => {
      console.error(`Request failed: ${request.url()} - ${request.failure().errorText}`);
    });

    await setupPage(page, width, height, url, delay);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const videoPath = await recordVideo(display, width, height, fps, duration, timestamp);

    let resultPath;
    let resultSize;
    if (format === 'gif') {
      resultPath = await convertToGif(videoPath, timestamp, fps);
      resultSize = await uploadGif(resultPath, timestamp);
    } else {
      resultPath = videoPath;
      resultSize = await uploadVideo(resultPath, timestamp);
    }

    res.status(200).send({ result: `https://storage.googleapis.com/html-to-video2/video_${timestamp}.${format === 'gif' ? 'gif' : 'mp4'}`, size: `${resultSize} MB` });
  } catch (error) {
    console.error('Error in createVideoFromHtml2 function:', error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed.');
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }

    if (xvfbProcess) {
      try {
        process.kill(-xvfbProcess.pid);
        console.log('Xvfb process killed.');
      } catch (error) {
        console.error('Error killing Xvfb process:', error);
      }
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}, version 2.1`);
});
