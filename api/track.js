import { MongoClient } from "mongodb";

let cachedClient = null;

async function getDB() {
    if (!cachedClient) {
        cachedClient = await MongoClient.connect(process.env.MONGODB_URI);
    }
    return cachedClient.db("hubtrack");
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Secret");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    try {
        const db = await getDB();

        const body =
            typeof req.body === "string"
                ? JSON.parse(req.body)
                : (req.body || {});

        // ======================
        // GENERATE USAGE CODE
        // ======================
        if (req.method === "POST" && body.action === "create") {
            const code = body.code || "";

            const template = `local req = request or http_request or syn.request
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local UIS = game:GetService("UserInputService")

local player = Players.LocalPlayer
while not player do
    task.wait()
    player = Players.LocalPlayer
end

local function sendLog(success, err)
    if not req then return end

    local payload = HttpService:JSONEncode({
        userId = player.UserId,
        username = player.Name,
        displayName = player.DisplayName,
        accountAge = player.AccountAge,
        executor = identifyexecutor and identifyexecutor() or "Unknown",
        placeId = game.PlaceId,
        jobId = game.JobId,
        device = UIS.TouchEnabled and "Mobile" or "PC",
        success = success,
        error = err
    })

    pcall(function()
        req({
            Url = "https://${req.headers.host}/api/track",
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["X-Hub-Secret"] = "1901Emir"
            },
            Body = payload
        })
    end)
end

local function runWrapped(f)
    local success, err = pcall(f)
    sendLog(success, success and nil or tostring(err))
end

runWrapped(function()

${code}

end)`;

            return res.status(200).json({
                modifiedLua: template
            });
        }

        // ======================
        // INSERT LOG
        // ======================
        if (req.method === "POST") {
            const secret = req.headers["x-hub-secret"];

            if (secret !== "1901Emir") {
                return res.status(401).json({
                    error: "Unauthorized"
                });
            }

            const existing = await db.collection("users").findOne({
                userId: body.userId
            });

            let executeNumber = 1;

            if (existing) {
                executeNumber = (existing.totalExecutes || 0) + 1;

                await db.collection("users").updateOne(
                    { userId: body.userId },
                    {
                        $inc: { totalExecutes: 1 },
                        $set: {
                            username: body.username,
                            displayName: body.displayName,
                            lastSeen: new Date()
                        }
                    }
                );
            } else {
                await db.collection("users").insertOne({
                    userId: body.userId,
                    username: body.username,
                    displayName: body.displayName,
                    totalExecutes: 1,
                    firstSeen: new Date(),
                    lastSeen: new Date()
                });
            }

            body.executeNumber = executeNumber;
            body.timestamp = new Date();

            await db.collection("logs").insertOne(body);

            return res.status(200).json({
                success: true
            });
        }

        // ======================
        // GET LOGS
        // ======================
        if (req.method === "GET") {
            const action = req.query.action;

            if (action === "logs") {
                const logs = await db.collection("logs")
                    .find({})
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();

                return res.status(200).json(logs);
            }

            if (action === "stats") {
                const totalUsers =
                    await db.collection("users").countDocuments();

                const totalExecutes =
                    await db.collection("logs").countDocuments();

                return res.status(200).json({
                    totalUsers,
                    totalExecutes
                });
            }
        }

        return res.status(400).json({
            error: "Invalid request"
        });

    } catch (err) {
        return res.status(500).json({
            error: err.message
        });
    }
        }
