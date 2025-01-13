const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json());

const setCORSHeaders = (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    next();
};

app.use(setCORSHeaders);

app.options('/createVideoFromHtml3', (req, res) => {
    res.status(204).send('');
});

const queue = [];
let isProcessing = false;
const statuses = {}; // Object to store the status of each request

const processQueue = async () => {
    if (queue.length === 0 || isProcessing) return;

    isProcessing = true;
    const { req, id } = queue.shift(); // Extract request data from the queue

    statuses[id] = 'processing'; // Update the status to processing
    console.log(`Processing request ${id}`);

    try {
        const { url, fps, duration, width, height, format, delay } = req.body;

        const response = await fetch('http://34.136.101.129:8080/createVideoFromHtml2', {    //CHANGE IP TO HTML TO VIDEO CONVERTER VM
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, fps, duration, width, height, format, delay })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Backend Error for ${id}: HTTP status: ${response.status}, details: ${errorText}`);
            throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
        }

        const data = await response.json();
        console.log(`Response received for request ${id}:`, data);

        // Ensure status is updated to completed
        statuses[id] = 'completed';
        statuses[`${id}_result`] = data.result; // Store the result
        console.log(`Request ${id} completed successfully.`);
    } catch (error) {
        console.error(`Error during video creation for request ${id}:`, error.message);
        statuses[id] = 'failed'; // Update the status to failed
    } finally {
        isProcessing = false;
        processQueue(); // Process the next item in the queue
    }
};

app.post('/createVideoFromHtml3', (req, res) => {
    const { url, fps, duration, width, height, delay } = req.body;

    if (!url || !fps || !duration || !width || !height) {
        res.status(400).send('URL, FPS, duration, width, and height are required');
        return;
    }

    const id = `req_${Date.now()}`;
    const queuePosition = queue.length + 1; // Calculate queue position before adding to the queue

    if (!isProcessing && queue.length === 0) {
        // If nothing is in progress, start processing immediately
        statuses[id] = 'processing';
        queue.push({ req, id }); // Add request to the queue
        console.log(`Request ${id} is in progress.`);
        res.status(202).send({ message: `Your request is in progress with ID ${id}`, id, position: 0 });
        processQueue(); // Start processing immediately
    } else {
        // If something is already in progress, add to queue
        statuses[id] = 'queued';
        queue.push({ req, id }); // Add request to the queue
        console.log(`Request ${id} queued in position ${queuePosition}.`);
        res.status(202).send({ message: `Your request is queued in position ${queuePosition}`, id, position: queuePosition });
    }
});

app.get('/checkStatus/:id', (req, res) => {
    const id = req.params.id;

    console.log(`Checking status for request ${id}`);

    if (!statuses[id]) {
        console.log(`Status check for ${id}: not found.`);
        res.status(404).send({ status: 'not found' });
    } else if (statuses[id] === 'completed') {
        console.log(`Status check for ${id}: completed. Returning result.`);
        res.status(200).send({ status: 'completed', result: statuses[`${id}_result`] });
    } else {
        console.log(`Status check for ${id}: ${statuses[id]}.`);
        res.status(200).send({ status: statuses[id] });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server is running on port ${PORT}`);
});
