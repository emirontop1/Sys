import { MongoClient } from "mongodb";

const DB_NAME = process.env.MONGODB_DB || "hubtrack";
const HUB_SECRET = process.env.HUB_SECRET || "1901Emir";
const MAX_LOGS = 250;

let cachedClient = null;
let cachedDb = null;

function getHeader(req, name) {
    const lower = name.toLowerCase();
    return req.headers?.[lower] || req.headers?.[name] || "";
}

function getBaseUrl(req, body = {}) {
    const explicitUrl = (body.baseUrl || process.env.PUBLIC_BASE_URL || "").trim();
    if (explicitUrl) {
        return explicitUrl.replace(/\/$/, "");
    }

    const host = getHeader(req, "x-forwarded-host") || getHeader(req, "host");
    const proto = getHeader(req, "x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");

    if (!host) {
        throw new Error("Host header is missing. Set PUBLIC_BASE_URL to generate usage code.");
    }

    return `${proto}://${host}`.replace(/\/$/, "");
}

async function getDB() {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not configured.");
    }

    if (!cachedClient) {
        cachedClient = new MongoClient(process.env.MONGODB_URI);
        await cachedClient.connect();
        cachedDb = cachedClient.db(DB_NAME);
        await ensureIndexes(cachedDb);
    }

    return cachedDb;
}

async function ensureIndexes(db) {
    await Promise.all([
        db.collection("logs").createIndex({ timestamp: -1 }),
        db.collection("logs").createIndex({ userId: 1, timestamp: -1 }),
        db.collection("users").createIndex({ userId: 1 }, { unique: true })
    ]);
}

function parseBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "string") {
        return req.body.trim() ? JSON.parse(req.body) : {};
    }
    return req.body;
}

function cleanString(value, fallback = "Unknown") {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
}

function normalizeLog(body, req) {
    const forwardedFor = getHeader(req, "x-forwarded-for");
    const ip = forwardedFor.split(",")[0]?.trim() || getHeader(req, "x-real-ip") || null;
    const country = getHeader(req, "x-vercel-ip-country") || body.country || "Unknown";

    return {
        scriptName: cleanString(body.scriptName, "Untitled Script"),
        userId: cleanString(body.userId),
        username: cleanString(body.username),
        displayName: cleanString(body.displayName, cleanString(body.username)),
        accountAge: Number(body.accountAge) || 0,
        executor: cleanString(body.executor),
        placeId: cleanString(body.placeId),
        jobId: cleanString(body.jobId, ""),
        device: cleanString(body.device),
        success: body.success !== false,
        error: body.error ? String(body.error).slice(0, 2000) : null,
        country: cleanString(country),
        ip,
        userAgent: getHeader(req, "user-agent") || null,
        timestamp: new Date()
    };
}

function buildLua({ code, baseUrl, scriptName }) {
    const endpoint = `${baseUrl}/api/track`;
    const escapedEndpoint = JSON.stringify(endpoint);
    const escapedSecret = JSON.stringify(HUB_SECRET);
    const escapedScriptName = JSON.stringify(scriptName || "Untitled Script");

    return `-- HubTrack Pro generated usage code
-- Script: ${scriptName || "Untitled Script"}
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local ENDPOINT = ${escapedEndpoint}
local SECRET = ${escapedSecret}
local SCRIPT_NAME = ${escapedScriptName}

local function getRequest()
    return (syn and syn.request)
        or (http and http.request)
        or http_request
        or request
        or (fluxus and fluxus.request)
        or (krnl and krnl.request)
end

local function getExecutor()
    local ok, result = pcall(function()
        if identifyexecutor then
            return identifyexecutor()
        end
        if getexecutorname then
            return getexecutorname()
        end
        return "Unknown"
    end)

    if ok and result then
        return tostring(result)
    end

    return "Unknown"
end

local function postLog(success, err)
    local req = getRequest()
    if not req then
        warn("HubTrack Pro: this executor does not expose an HTTP request function")
        return
    end

    local player = Players.LocalPlayer
    local payload = {
        scriptName = SCRIPT_NAME,
        userId = player and player.UserId or 0,
        username = player and player.Name or "Unknown",
        displayName = player and player.DisplayName or "Unknown",
        accountAge = player and player.AccountAge or 0,
        executor = getExecutor(),
        placeId = game.PlaceId,
        jobId = game.JobId,
        device = UserInputService.TouchEnabled and "Mobile" or "PC",
        success = success,
        error = err and tostring(err) or nil
    }

    local body = HttpService:JSONEncode(payload)
    pcall(function()
        req({
            Url = ENDPOINT,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["X-Hub-Secret"] = SECRET
            },
            Body = HttpService:JSONEncode(payload)
        })
    end)
end

local function runUserScript()
${code}
end

local ok, err = xpcall(runUserScript, debug.traceback)
postLog(ok, err)
if not ok then
    error(err)
end`;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Secret");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }

    try {
        const body = parseBody(req);

        if (req.method === "POST" && body.action === "create") {
            const code = String(body.code || "");
            const scriptName = cleanString(body.name, "Untitled Script");

            return res.status(200).json({
                modifiedLua: buildLua({ code, baseUrl: getBaseUrl(req, body), scriptName })
            });
        }

        if (req.method === "POST") {
            if (getHeader(req, "x-hub-secret") !== HUB_SECRET) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const db = await getDB();
            const logsCollection = db.collection("logs");
            const usersCollection = db.collection("users");
            const log = normalizeLog(body, req);
            const userUpdate = await usersCollection.findOneAndUpdate(
                { userId: log.userId },
                {
                    $set: {
                        userId: log.userId,
                        username: log.username,
                        displayName: log.displayName,
                        executor: log.executor,
                        lastSeen: log.timestamp
                    },
                    $setOnInsert: { firstSeen: log.timestamp },
                    $inc: { totalExecutes: 1 }
                },
                { upsert: true, returnDocument: "after" }
            );

            log.executeNumber = userUpdate?.totalExecutes || 1;
            await logsCollection.insertOne(log);

            return res.status(200).json({ success: true, executeNumber: log.executeNumber });
        }

        if (req.method === "GET") {
            const db = await getDB();
            const logsCollection = db.collection("logs");
            const usersCollection = db.collection("users");
            const action = req.query?.action || "logs";

            if (action === "logs" || action === "data") {
                const logs = await logsCollection.find({}).sort({ timestamp: -1 }).limit(MAX_LOGS).toArray();
                return res.status(200).json(logs);
            }

            if (action === "stats") {
                const [totalUsers, totalExecutes, executorStats, errorStats] = await Promise.all([
                    usersCollection.countDocuments(),
                    logsCollection.countDocuments(),
                    logsCollection.distinct("executor"),
                    logsCollection.countDocuments({ success: false })
                ]);

                return res.status(200).json({
                    totalUsers,
                    totalExecutes,
                    totalExecutors: executorStats.filter(Boolean).length,
                    errorRate: totalExecutes ? Math.round((errorStats / totalExecutes) * 100) : 0
                });
            }

            return res.status(400).json({ error: "Invalid action" });
        }

        return res.status(405).json({ error: "Method not allowed" });
    } catch (err) {
        return res.status(500).json({ error: err.message || "Internal server error" });
    }
}
