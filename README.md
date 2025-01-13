# HTML-to-Video Conversion Pipeline

**Version: 1.0.1**  
*(Increment the version number whenever you change the code.)*

This repository provides a pipeline to convert an HTML page into a video using:
1. A **Request Manager** (running on Google Cloud Run).
2. An **HTML-to-Video Node.js Service** (running on a GPU-enabled VM).
3. A **Client Script** for sending requests and polling completion.

Below is a guide on using, deploying, and important considerations gathered from prior discussions.

---

## 1. HTML-to-Video Node.js Service (GPU VM)

### Overview
- Deployed on a **GPU-enabled VM** using Docker.
- Uses **Puppeteer**, **Xvfb**, **PulseAudio**, and **ffmpeg** to render and record HTML content.
- By default, listens on **port 8080** and uploads the final video to a Google Cloud Storage bucket (e.g., `html-to-video2`).

### Key Functionalities
1. **Video Element Detection**  
   - If a `<video>` element is present, the service attempts to **play the video** and waits until it starts before recording.
2. **Manual Delay**  
   - You can specify a `delay` (milliseconds) to wait before recording begins, giving extra time for animations or dynamic content.
3. **User Interaction Simulation**  
   - Presses the spacebar to trigger any event requiring user input.
   - Requests fullscreen so the content fills the capture area.
4. **Recording & Audio Capture**  
   - **Xvfb** simulates a display, enabling Puppeteer to run in a “headless” environment.
   - **PulseAudio** plus a **virtual sink** captures and merges audio into the video.
5. **Final Output**  
   - Default output is `MP4` at the specified FPS, resolution, and duration.
   - Uploaded to Google Cloud Storage, returning a public URL and file size.

### Building & Running the Docker Image
```bash
# 1. Build the Docker image (locally or on the VM)
docker build -t html_to_video_gpu .

# 2. Run the container with GPU access, example:
docker run --cpus="7" --memory="16g" --gpus all \
    --runtime=nvidia --privileged \
    -p 8080:8080 \
    --name html-to-video \
    -it html_to_video_gpu
```
*(Adjust CPU, memory, and ports as needed.)*

### Local Testing on the VM
You can test the service **directly** on the VM (without the Request Manager):
```bash
curl -X POST http://localhost:8080/createVideoFromHtml2 \
     -H "Content-Type: application/json" \
     -d '{
           "url": "https://example.com",
           "fps": 60,
           "duration": 12,
           "width": 1920,
           "height": 1080,
           "delay": 0
         }'
```

### Tracking Logs
If the service is managed by `systemd` (e.g., `html-to-video.service`), tail the logs:
```bash
sudo journalctl -u html-to-video.service -f
```

---

## 2. Request Manager (Cloud Run)

### Overview
- Exposes `/createVideoFromHtml3` to accept video-creation requests.
- Queues incoming requests; processes one at a time.
- Forwards requests to the **HTML-to-Video** VM at its internal/external IP.
- Tracks statuses (`queued`, `processing`, `completed`, `failed`) and provides results on `/checkStatus/:id`.

### Automated VM Lifecycle (Optional)
If you want to **start/stop the VM automatically** based on incoming requests:
- You can integrate **gcloud** commands in the Request Manager code to:
  - **Start** the VM if it’s not running.
  - **Wait** for the HTML-to-Video service to be ready.
  - **Forward** requests for conversion.
  - **Stop** the VM once the queue is empty (and keep it running if new requests arrive before it’s stopped).

This approach can **reduce costs** by only running the GPU VM when needed.

### Building & Deploying to Cloud Run
```bash
# 1. Build the Docker image
docker build -t request_manager .

# 2. Push to Google Container Registry
docker tag request_manager gcr.io/YOUR_PROJECT_ID/request_manager:1.0.1
docker push gcr.io/YOUR_PROJECT_ID/request_manager:1.0.1

# 3. Deploy to Cloud Run
gcloud run deploy request-manager-service \
    --image gcr.io/YOUR_PROJECT_ID/request_manager:1.0.1 \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated
```

**Important**: In the code, **update** the IP for `createVideoFromHtml2` to point to your GPU VM’s **internal or external IP**.

---

## 3. Client Script

### Overview
- Sends a **POST** to `.../createVideoFromHtml3` with parameters like URL, FPS, duration, etc.
- Receives a unique **ID** and checks `/checkStatus/:id` until the status is `completed` or `failed`.
- Once completed, returns the **public URL** to the video in Google Cloud Storage.

### Example
```js
(async () => {
  // 1. Create a request
  const createResponse = await fetch('https://YOUR_CLOUD_RUN_URL/createVideoFromHtml3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com',
      fps: 30,
      duration: 10,
      width: 1920,
      height: 1080,
      format: 'mp4',
      delay: 0
    })
  });
  const { id } = await createResponse.json();

  // 2. Poll for status
  const checkStatus = async (id) => {
    const statusResponse = await fetch(`https://YOUR_CLOUD_RUN_URL/checkStatus/${id}`);
    const statusData = await statusResponse.json();
    if (statusData.status === 'completed') {
      console.log('Video created:', statusData.result);
      return statusData.result;
    } else if (statusData.status === 'failed') {
      console.log('Video creation failed.');
      return null;
    } else {
      console.log(`Status: ${statusData.status}. Retrying in 5 seconds...`);
      return new Promise(resolve => setTimeout(() => resolve(checkStatus(id)), 5000));
    }
  };

  // Start polling
  const videoUrl = await checkStatus(id);
  if (videoUrl) console.log('Final Video URL:', videoUrl);
})();
```

---

## Usage Flow

1. **Deploy** HTML-to-Video on the GPU VM (or build/run Docker locally for testing).
2. **Deploy** the Request Manager to Cloud Run.
3. **Send** requests from a **client script** to the manager’s `/createVideoFromHtml3`.
4. **Manager** forwards them to the **HTML-to-Video** service.
5. **Poll** `/checkStatus/:id` to get the final video URL upon completion.

---

## Additional Notes

- **Internal vs. External IP**:  
  - Use the internal IP if Cloud Run and the VM share a VPC (faster, cheaper, more secure).
  - Otherwise, use the VM’s external IP.
- **Security & Permissions**:
  - The Node.js service must have **GCS upload permissions** to the `html-to-video2` bucket (or your chosen bucket).
  - The Cloud Run service must be allowed to **access** the VM (internal or external).
- **Resource Configuration**:
  - Adjust CPU, memory, and GPU settings in the Docker container to match your workload.
- **Logging**:
  - **Request Manager** logs are available in Cloud Run logs.
  - **HTML-to-Video** logs can be found in Docker logs or via `systemd` if you installed it as a service.
- **Versioning**:
  - Update the **Version** at the top of this README any time you make a code or container change.

---

**Happy automating your HTML-to-video conversions!**