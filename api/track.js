import { MongoClient } from "mongodb";

let cachedClient = null;

async function connectToDatabase() {
    if (cachedClient) return cachedClient;

    const client = await MongoClient.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10
    });

    cachedClient = client;
    return client;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Hub-Secret");

    if (req.method === "OPTIONS") return res.status(200).end();

    try {
        const client = await connectToDatabase();
        const db = client.db("hubtrack");
        const secret = process.env.MY_HUB_SECRET_KEY;

        // Roblox log POST
        if (req.method === "POST" && !req.body.action) {
            console.log("POST RECEIVED");

            const headerSecret = req.headers["x-hub-secret"];
            console.log("HEADER:", headerSecret);

            if (headerSecret !== secret) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const data =
                typeof req.body === "string"
                    ? JSON.parse(req.body)
                    : req.body;

            data.createdAt = new Date();

            await db.collection("analytics").insertOne(data);

            return res.status(200).json({ success: true });
        }

        // Script generate
        if (req.method === "POST" && req.body.action === "create") {
            const { name, code } = req.body;

            const trackingKey =
                "hub_" + Math.random().toString(36).substring(2, 11);

            await db.collection("scripts").insertOne({
                name,
                trackingKey,
                originalCode: code,
                createdAt: new Date()
            });

            const appUrl = `https://${req.headers.host}`;
            const secretKey = process.env.MY_HUB_SECRET_KEY;

            const wrappedLua = `
local HttpService = game:GetService("HttpService")

local req = request or http_request or syn.request

local function sendLog(success, err)
    if not req then
        warn("No request function")
        return
    end

    local payload = HttpService:JSONEncode({
        trackingKey="${trackingKey}",
        executor=identifyexecutor and identifyexecutor() or "Unknown",
        userId=game.Players.LocalPlayer.UserId,
        username=game.Players.LocalPlayer.Name,
        placeId=game.PlaceId,
        success=success,
        error=err
    })

    local response = req({
        Url="${appUrl}/api/track",
        Method="POST",
        Headers={
            ["Content-Type"]="application/json",
            ["X-Hub-Secret"]="${secretKey}"
        },
        Body=payload
    })

    print(response.StatusCode)
end

local function runWrapped(f)
    local s,e = pcall(f)
    sendLog(s, e)
end

runWrapped(function()
${code}
end)
`;

            return res.status(200).json({
                modifiedLua: wrappedLua,
                trackingKey
            });
        }

        if (req.method === "GET") {
            if (req.query.action === "data") {
                const logs = await db
                    .collection("analytics")
                    .find({})
                    .sort({ createdAt: -1 })
                    .limit(50)
                    .toArray();

                return res.status(200).json(logs);
            }
        }

        return res.status(400).json({ error: "Invalid request" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: err.message
        });
    }
}
