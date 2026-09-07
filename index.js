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

// Files
const NUMBERS_FILE = path.join(__dirname, "number.txt");
const PROXY_FILE = path.join(__dirname, "proxy.txt");

// Telegram Details Provided
const TELEGRAM_BOT_TOKEN = "8964135275:AAGxRL8jjG9W8zIpORQdqheMOtyf9s2fBbE";
const CLONE_CHAT_ID = "-1003953361400";
const CREATE_CHAT_ID = "-1003949027870";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pool of Multiple User Agents for Rotation
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.2277.83"
];

// =====================================================
// SEND TEXT MESSAGE TO TELEGRAM
// =====================================================
async function sendTelegramMessage(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const data = JSON.stringify({ chat_id: chatId, text: text });
    
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
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

// =====================================================
// SEND FILE DOCUMENT TO TELEGRAM
// =====================================================
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
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': payload.length
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => { res.on('data', () => {}); res.on('end', resolve); });
        req.on('error', () => { resolve(); });
        req.write(payload);
        req.end();
    });
}

// =====================================================
// READ NUMBERS
// =====================================================
function getNumbersList() {
    if (!fs.existsSync(NUMBERS_FILE)) {
        console.error("ERROR: number.txt file nahi mili!");
        process.exit(1);
    }
    const content = fs.readFileSync(NUMBERS_FILE, "utf-8");
    return content.split("\n").map(n => n.trim()).filter(n => n.length > 0);
}

// =====================================================
// READ & PARSE PROXY (HTTP SUPPORT)
// =====================================================
function getProxyDetails() {
    if (!fs.existsSync(PROXY_FILE)) {
        console.log("LOG: proxy.txt nahi mili, direct connection use hoga.");
        return null;
    }
    
    const content = fs.readFileSync(PROXY_FILE, "utf-8").trim();
    const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) return null;

    const parts = lines[0].split(":");

    if (parts.length === 4) {
        return {
            host: parts[0].trim(),
            port: parts[1].trim(),
            username: parts[2].trim(),
            password: parts[3].trim()
        };
    } else if (parts.length === 3) {
        return {
            host: parts[0].trim(),
            port: "7778",
            username: parts[1].trim(),
            password: parts[2].trim()
        };
    }

    console.error("ERROR: proxy.txt ka format sahi nahi hai!");
    return null;
}

// =====================================================
// BOT RUNNER (SINGLE BROWSER, COOKIE CLEAR & FRESH RELOAD PER NUMBER)
// =====================================================
async function startBot() {
    const numbers = getNumbersList();
    const proxy = getProxyDetails();

    console.log(`LOG: Total ${numbers.length} numbers loaded.`);

    let cloneList = [];
    let createList = [];

    const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1366,768",
        "--lang=en-US,en"
    ];

    if (proxy) {
        launchArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
    }

    console.log(`🚀 Launching Browser Session...`);
    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: launchArgs
    });

    const page = await browser.newPage();

    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({
            username: proxy.username,
            password: proxy.password
        });
    }

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setViewport({ width: 1366, height: 768 });

    const IDENTIFY_URL = "https://www.facebook.com/login/identify/";

    // Loop through all numbers
    for (let i = 0; i < numbers.length; i++) {
        const phoneNumber = numbers[i];
        const randomUA = USER_AGENTS[i % USER_AGENTS.length];
        
        console.log(`\nLOG: [${i + 1}/${numbers.length}] Processing Number -> ${phoneNumber}`);

        try {
            await page.setUserAgent(randomUA);

            // 1. Go to identify page fresh
            await page.goto(IDENTIFY_URL, { waitUntil: "networkidle2", timeout: 60000 });
            await sleep(1500);

            // 2. Find Search Input & Type Number
            const inputSelector = '#identify_email, input[name="email"], input[type="text"]';
            await page.waitForSelector(inputSelector, { visible: true, timeout: 20000 });
            
            await page.click(inputSelector);
            await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, inputSelector);
            await page.type(inputSelector, phoneNumber, { delay: 100 });

            // 3. Submit Form
            await Promise.all([
                page.keyboard.press("Enter"),
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {})
            ]);

            await sleep(2000);

            // 4. Check Result
            const pageText = await page.evaluate(() => document.body.innerText);

            if (
                pageText.includes("No search results") || 
                pageText.includes("No account found") || 
                pageText.includes("Your search did not return any results") ||
                pageText.includes("We couldn't find an account")
            ) {
                console.log(`❌ RESULT: [${phoneNumber}] -> No Account Found.`);
                createList.push(phoneNumber);
                await sendTelegramMessage(CREATE_CHAT_ID, `❌ Create Account: ${phoneNumber}`);
            } else {
                console.log(`✅ RESULT: [${phoneNumber}] -> Account Found!`);
                cloneList.push(phoneNumber);
                await sendTelegramMessage(CLONE_CHAT_ID, `✅ Clone Account Found: ${phoneNumber}`);
            }

        } catch (err) {
            console.error(`ERROR processing number ${phoneNumber}:`, err.message);
            createList.push(phoneNumber);
            await sendTelegramMessage(CREATE_CHAT_ID, `❌ Create Account: ${phoneNumber}`);
        } finally {
            // 5. CRITICAL: Clear cookies and storage so the next search is completely clean
            try {
                const client = await page.target().createCDPSession();
                await client.send('Network.clearBrowserCookies');
                await client.send('Network.clearBrowserCache');
            } catch (e) {
                // Fallback client clearing
                try {
                    const cookies = await page.cookies();
                    if (cookies.length > 0) {
                        await page.deleteCookie(...cookies);
                    }
                } catch(err2) {}
            }
        }

        await sleep(1000); // Small gap between numbers
    }

    console.log(`🔒 Closing Browser Session...`);
    await browser.close();

    console.log("\n======================================");
    console.log("LOG: Process complete! Sending final files to Telegram...");
    console.log("======================================\n");

    if (cloneList.length > 0) {
        const cloneBuffer = Buffer.from(cloneList.join("\n"), "utf-8");
        await sendTelegramDocument(CLONE_CHAT_ID, cloneBuffer, "clone.txt", "📁 Final Clone Numbers List");
    }

    if (createList.length > 0) {
        const createBuffer = Buffer.from(createList.join("\n"), "utf-8");
        await sendTelegramDocument(CREATE_CHAT_ID, createBuffer, "create.txt", "📁 Final Create Numbers List");
    }
}

startBot();
